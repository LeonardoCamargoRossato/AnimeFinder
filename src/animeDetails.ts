import { animeProvider } from './providers'
import type {
  Anime,
  AnimeCharacterCredit,
  AnimeRelation,
  AnimeRelationEntry,
  AnimeStaffCredit,
  AnimeStreamingLink,
} from './types'

export interface AnimeDetailsOverview {
  anime: Anime
  director: string | null
  creator: string | null
  mangaka: string | null
  sourceTitle: string | null
  sourceType: string | null
  studio: string | null
}

export interface RelatedWork {
  malId: number
  title: string
  poster: string | null
  malScore: number | null
  type: string | null
  year: number | null
  relationType: string
}

export interface FranchiseResult {
  works: RelatedWork[]
  average: number | null
  scoredWorkCount: number
}

export interface NerdDatum<T = string | string[] | number> {
  value: T
  source: string
  sourceUrl?: string | null
  retrievedAt: string
}

export interface NerdField {
  label: string
  datum: NerdDatum
}

export interface NerdSection {
  id: 'publication' | 'creators' | 'animation' | 'voiceCast' | 'distribution' | 'sourcePerformance' | 'marketReception'
  label: string
  fields: NerdField[]
}

export interface NerdData {
  sections: NerdSection[]
  dubbingLanguages: string[]
}

const SOURCE_NAME = 'MyAnimeList catalogue / Tenrai'
const overviewCache = new Map<number, Promise<AnimeDetailsOverview>>()
const franchiseCache = new Map<number, Promise<FranchiseResult>>()
const nerdCache = new Map<number, Promise<NerdData>>()

function firstPersonForRole(staff: AnimeStaffCredit[], matcher: (position: string) => boolean) {
  return staff.find((credit) => credit.positions.some(matcher))?.person.name ?? null
}

function peopleForRole(staff: AnimeStaffCredit[], matcher: (position: string) => boolean, limit = 12) {
  return staff
    .filter((credit) => credit.positions.some(matcher))
    .map((credit) => credit.person.name)
    .filter((name, index, values) => values.indexOf(name) === index)
    .slice(0, limit)
}

function findSourceMaterial(relations: AnimeRelation[]) {
  for (const relation of relations) {
    if (relation.relation.toLowerCase() !== 'adaptation') continue
    const source = relation.entries.find((entry) => entry.type.toLowerCase() !== 'anime')
    if (source) return source
  }
  return null
}

async function allSettledValue<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try { return await promise } catch { return fallback }
}

export const animeDetailsService = {
  getOverview(malId: number): Promise<AnimeDetailsOverview> {
    const cached = overviewCache.get(malId)
    if (cached) return cached

    const pending = (async () => {
      const anime = await animeProvider.getAnime(malId)
      const [staff, relations] = await Promise.all([
        allSettledValue(animeProvider.getAnimeStaff(malId), [] as AnimeStaffCredit[]),
        allSettledValue(animeProvider.getAnimeRelations(malId), [] as AnimeRelation[]),
      ])
      const source = findSourceMaterial(relations)
      const director = firstPersonForRole(staff, (position) => position.toLowerCase() === 'director')
        ?? firstPersonForRole(staff, (position) => /^director\b/i.test(position) && !/animation|art|sound|episode/i.test(position))
      const creator = firstPersonForRole(staff, (position) => /original creator/i.test(position))
      return {
        anime,
        director,
        creator,
        mangaka: null,
        sourceTitle: source?.name ?? null,
        sourceType: source?.mediaType ?? anime.source ?? null,
        studio: anime.studios?.[0]?.name ?? null,
      }
    })().catch((error) => { overviewCache.delete(malId); throw error })

    overviewCache.set(malId, pending)
    return pending
  },
}

const FRANCHISE_RELATION_TYPES = new Set([
  'sequel',
  'prequel',
  'side story',
  'alternative version',
  'parent story',
  'spin-off',
  'summary',
])

export function isFranchiseWork(relation: string, entry: AnimeRelationEntry) {
  return entry.type.toLowerCase() === 'anime' && FRANCHISE_RELATION_TYPES.has(relation.trim().toLowerCase())
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await mapper(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

function relationPriority(relationType: string) {
  const value = relationType.toLowerCase()
  if (value === 'selected') return -10
  if (value === 'prequel') return 0
  if (value === 'sequel') return 1
  if (value === 'parent story') return 2
  if (value === 'side story') return 3
  if (value === 'spin-off') return 4
  if (value === 'alternative version') return 5
  if (value === 'summary') return 6
  return 9
}

function mediaPriority(type: string | null) {
  const value = type?.toLowerCase() ?? ''
  if (value === 'tv') return 0
  if (value === 'movie') return 1
  if (value === 'ova') return 2
  if (value === 'special' || value === 'tv special') return 3
  if (value === 'ona') return 4
  return 5
}

export const franchiseService = {
  getFranchise(malId: number): Promise<FranchiseResult> {
    const cached = franchiseCache.get(malId)
    if (cached) return cached

    const pending = (async () => {
      const MAX_DEPTH = 2
      const MAX_RELATION_REQUESTS = 10
      const MAX_WORKS = 24
      const discovered = new Map<number, { relationType: string; hintedTitle?: string }>()
      discovered.set(malId, { relationType: 'Selected' })
      const visitedRelations = new Set<number>()
      const queue: Array<{ id: number; depth: number }> = [{ id: malId, depth: 0 }]
      let relationRequests = 0

      while (queue.length && relationRequests < MAX_RELATION_REQUESTS && discovered.size < MAX_WORKS) {
        const node = queue.shift()!
        if (visitedRelations.has(node.id)) continue
        visitedRelations.add(node.id)
        relationRequests += 1
        const relations = await allSettledValue(animeProvider.getAnimeRelations(node.id), [] as AnimeRelation[])

        for (const relation of relations) {
          for (const entry of relation.entries) {
            if (!isFranchiseWork(relation.relation, entry)) continue
            if (!discovered.has(entry.malId) && discovered.size < MAX_WORKS) {
              discovered.set(entry.malId, { relationType: relation.relation, hintedTitle: entry.name })
              if (node.depth < MAX_DEPTH) queue.push({ id: entry.malId, depth: node.depth + 1 })
            }
          }
        }
      }

      const ids = Array.from(discovered.keys())
      const works = (await mapWithConcurrency(ids, 3, async (id) => {
        try {
          const anime = await animeProvider.getAnime(id)
          const relation = discovered.get(id)!
          return {
            malId: anime.malId,
            title: anime.title,
            poster: anime.imageUrl ?? anime.largeImageUrl ?? null,
            malScore: anime.score ?? null,
            type: anime.type ?? null,
            year: anime.year ?? null,
            relationType: relation.relationType,
          } satisfies RelatedWork
        } catch {
          const relation = discovered.get(id)!
          return {
            malId: id,
            title: relation.hintedTitle ?? `MAL #${id}`,
            poster: null,
            malScore: null,
            type: null,
            year: null,
            relationType: relation.relationType,
          } satisfies RelatedWork
        }
      })).sort((a, b) => {
        if (a.malId === malId) return -1
        if (b.malId === malId) return 1
        const yearA = a.year ?? Number.MAX_SAFE_INTEGER
        const yearB = b.year ?? Number.MAX_SAFE_INTEGER
        return relationPriority(a.relationType) - relationPriority(b.relationType)
          || mediaPriority(a.type) - mediaPriority(b.type)
          || yearA - yearB
          || a.title.localeCompare(b.title)
      })

      const scores = works
        .map((work) => work.malScore)
        .filter((score): score is number => typeof score === 'number' && Number.isFinite(score) && score > 0 && score <= 10)
      const average = scores.length ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) / 100 : null
      return { works, average, scoredWorkCount: scores.length }
    })().catch((error) => { franchiseCache.delete(malId); throw error })

    franchiseCache.set(malId, pending)
    return pending
  },
}

function field(label: string, value: string | string[] | number | null | undefined, sourceUrl?: string | null): NerdField | null {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return null
  return { label, datum: { value, source: SOURCE_NAME, sourceUrl, retrievedAt: new Date().toISOString() } }
}

function compactFields(values: Array<NerdField | null>): NerdField[] {
  return values.filter((value): value is NerdField => value != null)
}

function voiceList(characters: AnimeCharacterCredit[], language: string) {
  const normalized = language.toLowerCase()
  const result: string[] = []
  for (const credit of characters) {
    const actors = credit.voiceActors.filter((actor) => actor.language.toLowerCase() === normalized)
    for (const actor of actors) {
      result.push(`${credit.character.name} — ${actor.person.name}`)
      if (result.length >= 10) return result
    }
  }
  return result
}

function languageSummary(characters: AnimeCharacterCredit[]) {
  const languages = new Set<string>()
  characters.forEach((credit) => credit.voiceActors.forEach((actor) => languages.add(actor.language)))
  return Array.from(languages).sort()
}

function streamingSummary(streaming: AnimeStreamingLink[]) {
  return streaming.map((entry) => entry.name).filter((name, index, values) => values.indexOf(name) === index)
}

export const nerdDataService = {
  getNerdData(malId: number, anime?: Anime): Promise<NerdData> {
    const cached = nerdCache.get(malId)
    if (cached) return cached

    const pending = (async () => {
      const resolvedAnime = anime ?? await animeProvider.getAnime(malId)
      const [staff, characters, streaming, relations] = await Promise.all([
        allSettledValue(animeProvider.getAnimeStaff(malId), [] as AnimeStaffCredit[]),
        allSettledValue(animeProvider.getAnimeCharacters(malId), [] as AnimeCharacterCredit[]),
        allSettledValue(animeProvider.getAnimeStreaming(malId), [] as AnimeStreamingLink[]),
        allSettledValue(animeProvider.getAnimeRelations(malId), [] as AnimeRelation[]),
      ])
      const source = findSourceMaterial(relations)
      const sourceUrl = resolvedAnime.url
      const creators = peopleForRole(staff, (position) => /original creator/i.test(position))
      const directors = peopleForRole(staff, (position) => position.toLowerCase() === 'director')
      const writers = peopleForRole(staff, (position) => /script|screenplay|series composition/i.test(position))
      const staffProducers = peopleForRole(staff, (position) => /producer/i.test(position))
      const animationStaff = staff
        .filter((credit) => credit.positions.some((position) => /animation director|chief animation|character design/i.test(position)))
        .slice(0, 10)
        .map((credit) => `${credit.person.name} — ${credit.positions.join(', ')}`)
      const japaneseVoices = voiceList(characters, 'Japanese')
      const englishVoices = voiceList(characters, 'English')
      const portugueseVoices = voiceList(characters, 'Portuguese (BR)')
      const dubbingLanguages = languageSummary(characters)

      const sections: NerdSection[] = [
        {
          id: 'publication',
          label: 'Publication',
          fields: compactFields([
            field('Source format', resolvedAnime.source, sourceUrl),
            field('Manga / Light Novel title', source?.name, source?.url),
            field('Source media type', source?.mediaType, source?.url),
          ]),
        },
        {
          id: 'creators',
          label: 'Creators',
          fields: compactFields([
            field('Original creator', creators, sourceUrl),
            field('Writer / Series composition', writers, sourceUrl),
            field('Director', directors, sourceUrl),
          ]),
        },
        {
          id: 'animation',
          label: 'Animation',
          fields: compactFields([
            field('Studio', resolvedAnime.studios?.map((studio) => studio.name), sourceUrl),
            field('Producer companies', resolvedAnime.producers?.map((producer) => producer.name), sourceUrl),
            field('Staff producers', staffProducers, sourceUrl),
            field('Key animation staff', animationStaff, sourceUrl),
          ]),
        },
        {
          id: 'voiceCast',
          label: 'Voice Cast',
          fields: compactFields([
            field('Japanese voice cast', japaneseVoices, sourceUrl),
            field('English voice cast', englishVoices, sourceUrl),
            field('Portuguese (BR) voice cast', portugueseVoices, sourceUrl),
            field('Recorded dub languages', dubbingLanguages, sourceUrl),
          ]),
        },
        {
          id: 'distribution',
          label: 'Distribution',
          fields: compactFields([
            field('Recorded streaming providers', streamingSummary(streaming), sourceUrl),
            field('Licensors', resolvedAnime.licensors?.map((licensor) => licensor.name), sourceUrl),
          ]),
        },
        { id: 'sourcePerformance', label: 'Manga Performance', fields: [] },
        {
          id: 'marketReception',
          label: 'Market & Reception',
          fields: compactFields([
            field('MAL score', resolvedAnime.score, sourceUrl),
            field('MAL rank', resolvedAnime.rank != null ? `#${resolvedAnime.rank}` : null, sourceUrl),
            field('Popularity', resolvedAnime.popularity != null ? `#${resolvedAnime.popularity}` : null, sourceUrl),
            field('Members', resolvedAnime.members?.toLocaleString(), sourceUrl),
            field('Favorites', resolvedAnime.favorites?.toLocaleString(), sourceUrl),
          ]),
        },
      ]

      return { sections, dubbingLanguages }
    })().catch((error) => { nerdCache.delete(malId); throw error })

    nerdCache.set(malId, pending)
    return pending
  },
}
