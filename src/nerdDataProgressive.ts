import { animeProvider } from './providers'
import type { Anime, AnimeCharacterCredit, AnimeRelation, AnimeStaffCredit, AnimeStreamingLink } from './types'
import type { NerdField, NerdSection } from './animeDetails'

export type NerdLoadState = 'idle' | 'loading' | 'success' | 'partial' | 'empty' | 'error'

export interface ProgressiveNerdSnapshot {
  state: NerdLoadState
  sections: NerdSection[]
  completedSources: number
  totalSources: number
  failedSources: number
  message?: string
}

const SOURCE = 'MyAnimeList catalogue / Tenrai'
const TIMEOUT_MS = 8000
const cache = new Map<number, Promise<ProgressiveNerdSnapshot>>()

function datum(label: string, value: string | string[] | number | null | undefined, sourceUrl?: string | null): NerdField | null {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return null
  return { label, datum: { value, source: SOURCE, sourceUrl, retrievedAt: new Date().toISOString() } }
}

function compact(values: Array<NerdField | null>): NerdField[] {
  return values.filter((value): value is NerdField => value != null)
}

function section(id: NerdSection['id'], label: string, fields: NerdField[] = []): NerdSection {
  return { id, label, fields }
}

function emptySections(): NerdSection[] {
  return [
    section('publication', 'Publication'),
    section('creators', 'Creators'),
    section('animation', 'Animation'),
    section('voiceCast', 'Voice Cast'),
    section('distribution', 'Distribution'),
    section('sourcePerformance', 'Manga Performance'),
    section('marketReception', 'Market & Reception'),
  ]
}

function mergeFields(sections: NerdSection[], id: NerdSection['id'], fields: NerdField[]) {
  const target = sections.find((entry) => entry.id === id)
  if (!target) return
  const byLabel = new Map(target.fields.map((entry) => [entry.label, entry]))
  fields.forEach((entry) => byLabel.set(entry.label, entry))
  target.fields = Array.from(byLabel.values())
}

function sourceMaterial(relations: AnimeRelation[]) {
  for (const relation of relations) {
    if (relation.relation.toLowerCase() !== 'adaptation') continue
    const entry = relation.entries.find((candidate) => candidate.type.toLowerCase() !== 'anime')
    if (entry) return entry
  }
  return null
}

function people(staff: AnimeStaffCredit[], matcher: (position: string) => boolean, limit = 12) {
  return staff
    .filter((credit) => credit.positions.some(matcher))
    .map((credit) => credit.person.name)
    .filter((name, index, values) => values.indexOf(name) === index)
    .slice(0, limit)
}

function voiceList(characters: AnimeCharacterCredit[], language: string, limit = 12) {
  const normalized = language.toLowerCase()
  const rows: string[] = []
  for (const credit of characters) {
    for (const actor of credit.voiceActors.filter((entry) => entry.language.toLowerCase() === normalized)) {
      rows.push(`${credit.character.name} — ${actor.person.name}`)
      if (rows.length >= limit) return rows
    }
  }
  return rows
}

function allLanguages(characters: AnimeCharacterCredit[]) {
  const languages = new Set<string>()
  characters.forEach((credit) => credit.voiceActors.forEach((actor) => languages.add(actor.language)))
  return Array.from(languages).sort()
}

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutId = 0
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)
  })
  try { return await Promise.race([promise, timeout]) }
  finally { window.clearTimeout(timeoutId) }
}

async function diagnostic<T>(malId: number, name: string, request: () => Promise<T>): Promise<T> {
  const started = performance.now()
  if (import.meta.env.DEV) console.debug(`[NerdData] MAL ${malId} → ${name}`)
  try {
    const result = await withTimeout(request(), name)
    if (import.meta.env.DEV) {
      const count = Array.isArray(result) ? result.length : 1
      console.debug(`[NerdData] MAL ${malId} ✓ ${name} · ${Math.round(performance.now() - started)}ms · ${count} records`)
    }
    return result
  } catch (error) {
    if (import.meta.env.DEV) console.warn(`[NerdData] MAL ${malId} ✕ ${name} · ${Math.round(performance.now() - started)}ms`, error)
    throw error
  }
}

function baseSections(anime: Anime) {
  const sections = emptySections()
  mergeFields(sections, 'publication', compact([
    datum('Source format', anime.source, anime.url),
  ]))
  mergeFields(sections, 'animation', compact([
    datum('Studio', anime.studios?.map((item) => item.name), anime.url),
    datum('Producer companies', anime.producers?.map((item) => item.name), anime.url),
  ]))
  mergeFields(sections, 'distribution', compact([
    datum('Licensors', anime.licensors?.map((item) => item.name), anime.url),
  ]))
  mergeFields(sections, 'marketReception', compact([
    datum('MAL score', anime.score, anime.url),
    datum('MAL rank', anime.rank != null ? `#${anime.rank}` : null, anime.url),
    datum('Popularity', anime.popularity != null ? `#${anime.popularity}` : null, anime.url),
    datum('Members', anime.members?.toLocaleString(), anime.url),
    datum('Favorites', anime.favorites?.toLocaleString(), anime.url),
  ]))
  return sections
}

function cloneSections(sections: NerdSection[]): NerdSection[] {
  return sections.map((entry) => ({ ...entry, fields: [...entry.fields] }))
}

function snapshotState(sections: NerdSection[], completed: number, failed: number, total: number, loading: boolean): ProgressiveNerdSnapshot {
  const fieldCount = sections.reduce((sum, entry) => sum + entry.fields.length, 0)
  const state: NerdLoadState = loading
    ? 'loading'
    : fieldCount === 0
      ? (failed === total ? 'error' : 'empty')
      : failed > 0
        ? 'partial'
        : 'success'
  return {
    state,
    sections: cloneSections(sections),
    completedSources: completed,
    totalSources: total,
    failedSources: failed,
    message: state === 'error' ? 'Advanced metadata unavailable.' : undefined,
  }
}

export function loadNerdDataProgressive(
  malId: number,
  anime: Anime,
  onUpdate?: (snapshot: ProgressiveNerdSnapshot) => void,
): Promise<ProgressiveNerdSnapshot> {
  const existing = cache.get(malId)
  if (existing) return existing

  const pending = (async () => {
    const sections = baseSections(anime)
    const TOTAL = 4
    let completed = 0
    let failed = 0
    onUpdate?.(snapshotState(sections, completed, failed, TOTAL, true))

    const tasks: Array<Promise<void>> = [
      (async () => {
        await delay(0)
        const staff = await diagnostic(malId, 'staff', () => animeProvider.getAnimeStaff(malId))
        mergeFields(sections, 'creators', compact([
          datum('Original creator', people(staff, (position) => /original creator/i.test(position)), anime.url),
          datum('Writer / Series composition', people(staff, (position) => /script|screenplay|series composition/i.test(position)), anime.url),
          datum('Director', people(staff, (position) => position.toLowerCase() === 'director'), anime.url),
        ]))
        mergeFields(sections, 'animation', compact([
          datum('Staff producers', people(staff, (position) => /producer/i.test(position)), anime.url),
          datum('Key animation staff', staff
            .filter((credit) => credit.positions.some((position) => /animation director|chief animation|character design/i.test(position)))
            .slice(0, 10)
            .map((credit) => `${credit.person.name} — ${credit.positions.join(', ')}`), anime.url),
        ]))
      })(),
      (async () => {
        await delay(350)
        const characters = await diagnostic(malId, 'characters / voice actors', () => animeProvider.getAnimeCharacters(malId))
        mergeFields(sections, 'voiceCast', compact([
          datum('Japanese voice cast', voiceList(characters, 'Japanese'), anime.url),
          datum('English voice cast', voiceList(characters, 'English'), anime.url),
          datum('Portuguese (BR) voice cast', voiceList(characters, 'Portuguese (BR)'), anime.url),
          datum('Recorded dub languages', allLanguages(characters), anime.url),
        ]))
      })(),
      (async () => {
        await delay(700)
        const streaming = await diagnostic(malId, 'streaming', () => animeProvider.getAnimeStreaming(malId))
        mergeFields(sections, 'distribution', compact([
          datum('Recorded streaming providers', (streaming as AnimeStreamingLink[]).map((item) => item.name).filter((name, index, values) => values.indexOf(name) === index), anime.url),
        ]))
      })(),
      (async () => {
        await delay(1050)
        const relations = await diagnostic(malId, 'relations / source', () => animeProvider.getAnimeRelations(malId))
        const source = sourceMaterial(relations)
        mergeFields(sections, 'publication', compact([
          datum('Manga / Light Novel title', source?.name, source?.url),
          datum('Source media type', source?.mediaType, source?.url),
        ]))
      })(),
    ]

    await Promise.allSettled(tasks.map(async (task) => {
      try { await task }
      catch { failed += 1 }
      finally {
        completed += 1
        onUpdate?.(snapshotState(sections, completed, failed, TOTAL, completed < TOTAL))
      }
    }))

    return snapshotState(sections, completed, failed, TOTAL, false)
  })().catch((error) => {
    cache.delete(malId)
    throw error
  })

  cache.set(malId, pending)
  return pending
}
