import { animeProvider } from './providers'
import { translationService } from './TranslationService'
import { findManagedWorkByMalId } from './personalCatalogManager'
import { loadMasterDataSnapshot } from './masterData'
import { isSupabaseConfigured, supabase } from './supabase'

export interface SynopsisBundle {
  original: string | null
  portuguese: string | null
  source: 'MyAnimeList catalogue' | 'AniList fallback' | null
  translationError?: string
  status?: SynopsisStatus
  storage?: 'supabase' | 'local' | 'memory'
  fetchedAt?: string | null
  translatedAt?: string | null
}

export type SynopsisStatus = 'complete' | 'original_only' | 'missing_source' | 'failed'

export interface StoredSynopsisRecord extends SynopsisBundle {
  personalWorkId: string
  malId: number | null
  sourceLanguage: string | null
  lastError?: string | null
}

export interface SynopsisBackfillProgress {
  total: number
  alreadyCached: number
  processed: number
  succeeded: number
  missingSource: number
  failed: number
  currentWork?: string
}

type SynopsisWorkRef = {
  id: string
  displayName: string
  primaryMalId: number | null
}

type AniListResponse = {
  data?: { Media?: { description?: string | null } | null }
  errors?: Array<{ message?: string }>
}

const synopsisCache = new Map<number, Promise<SynopsisBundle>>()
const LOCAL_KEY = 'animefinder.synopsisCache.v3'

function cleanSynopsis(value?: string | null): string | null {
  if (!value) return null
  const withBreaks = value.replace(/<br\s*\/?\s*>/gi, '\n')
  const container = document.createElement('div')
  container.innerHTML = withBreaks
  const cleaned = (container.textContent || container.innerText || '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
  if (!cleaned) return null
  if (/no synopsis information has been added/i.test(cleaned)) return null
  if (/no description available/i.test(cleaned)) return null
  return cleaned
}

function readLocal(): Record<string, StoredSynopsisRecord> {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as Record<string, StoredSynopsisRecord> } catch { return {} }
}

function writeLocal(record: StoredSynopsisRecord) {
  const rows = readLocal()
  rows[record.personalWorkId] = record
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(rows)) } catch { /* best effort mirror */ }
  window.dispatchEvent(new CustomEvent('animefinder:synopsis-cache-updated', { detail: record }))
}

function localRecord(workId: string) {
  return readLocal()[workId] ?? null
}

function localRecordByMalId(malId: number) {
  return Object.values(readLocal()).find((row) => row.malId === malId) ?? null
}

function isMissingTable(error: { code?: string; message?: string } | null | undefined) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase()
  return text.includes('42p01') || text.includes('pgrst205') || text.includes('personal_work_synopsis')
}

async function currentUserId() {
  if (!isSupabaseConfigured || !supabase) return null
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  return data.user.id
}

function fromRemoteRow(data: any): StoredSynopsisRecord {
  return {
    personalWorkId: data.personal_work_id,
    malId: data.mal_id == null ? null : Number(data.mal_id),
    original: data.synopsis_original ?? null,
    portuguese: data.synopsis_pt_br ?? null,
    source: data.synopsis_source === 'AniList fallback' ? 'AniList fallback' : data.synopsis_source ? 'MyAnimeList catalogue' : null,
    sourceLanguage: data.synopsis_source_language ?? null,
    status: (data.status ?? 'failed') as SynopsisStatus,
    lastError: data.last_error ?? null,
    translationError: data.status === 'original_only' ? data.last_error ?? undefined : undefined,
    fetchedAt: data.synopsis_fetched_at ?? data.updated_at ?? null,
    translatedAt: data.synopsis_translated_at ?? null,
    storage: 'supabase',
  }
}

async function loadRemote(workId: string): Promise<StoredSynopsisRecord | null> {
  const uid = await currentUserId()
  if (!uid || !supabase) return null
  const { data, error } = await supabase.from('personal_work_synopsis')
    .select('personal_work_id,mal_id,synopsis_original,synopsis_pt_br,synopsis_source,synopsis_source_language,status,last_error,synopsis_fetched_at,synopsis_translated_at,updated_at')
    .eq('user_id', uid)
    .eq('personal_work_id', workId)
    .maybeSingle()
  if (error) {
    console.error('AnimeFinder synopsis read failed.', {
      operation: 'synopsis_read', entity: workId, code: error.code, message: error.message, missingMigration: isMissingTable(error),
    })
    throw new Error(error.message)
  }
  if (!data) return null
  const record = fromRemoteRow(data)
  writeLocal(record)
  return record
}

async function persist(record: StoredSynopsisRecord): Promise<StoredSynopsisRecord> {
  const uid = await currentUserId()
  if (!uid || !supabase) {
    const local = { ...record, storage: 'local' as const }
    writeLocal(local)
    return local
  }

  const { error } = await supabase.from('personal_work_synopsis').upsert({
    user_id: uid,
    personal_work_id: record.personalWorkId,
    mal_id: record.malId,
    synopsis_original: record.original,
    synopsis_pt_br: record.portuguese,
    synopsis_source: record.source,
    synopsis_source_language: record.sourceLanguage,
    status: record.status,
    last_error: record.lastError ?? record.translationError ?? null,
    synopsis_fetched_at: record.fetchedAt ?? new Date().toISOString(),
    synopsis_translated_at: record.translatedAt ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,personal_work_id' })

  if (error) {
    console.error('AnimeFinder synopsis save failed.', {
      operation: 'synopsis_write', entity: record.personalWorkId, code: error.code, message: error.message, missingMigration: isMissingTable(error),
    })
    throw new Error(error.message)
  }

  const { data: readBack, error: readError } = await supabase.from('personal_work_synopsis')
    .select('personal_work_id,mal_id,synopsis_original,synopsis_pt_br,synopsis_source,synopsis_source_language,status,last_error,synopsis_fetched_at,synopsis_translated_at,updated_at')
    .eq('user_id', uid)
    .eq('personal_work_id', record.personalWorkId)
    .maybeSingle()

  if (readError || !readBack) {
    console.error('AnimeFinder synopsis read-back failed.', {
      operation: 'synopsis_read_back', entity: record.personalWorkId, code: readError?.code, message: readError?.message,
    })
    throw new Error(readError?.message ?? 'Synopsis read-back returned no row.')
  }

  const verified = fromRemoteRow(readBack)
  const matches = verified.original === record.original
    && verified.portuguese === record.portuguese
    && verified.status === record.status
  if (!matches) throw new Error('Synopsis read-back did not match the written values.')

  writeLocal(verified)
  return verified
}

async function fetchAniListSynopsis(malId: number): Promise<string | null> {
  const query = `query ($idMal: Int) { Media(idMal: $idMal, type: ANIME) { description(asHtml: false) } }`
  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { idMal: malId } }),
  })
  if (!response.ok) return null
  const payload = await response.json() as AniListResponse
  return cleanSynopsis(payload.data?.Media?.description)
}

async function fetchOriginal(malId: number): Promise<{ original: string | null; source: SynopsisBundle['source'] }> {
  try {
    const anime = await animeProvider.getAnime(malId)
    const original = cleanSynopsis(anime.synopsis)
    if (original) return { original, source: 'MyAnimeList catalogue' }
  } catch { /* fallback below */ }
  try {
    const original = await fetchAniListSynopsis(malId)
    if (original) return { original, source: 'AniList fallback' }
  } catch { /* no source */ }
  return { original: null, source: null }
}

export async function loadStoredSynopsis(workId: string): Promise<StoredSynopsisRecord | null> {
  const uid = await currentUserId()
  if (uid && supabase) return loadRemote(workId)
  return localRecord(workId)
}

export function getCachedSynopsisRecords(workIds?: string[]) {
  const rows = readLocal()
  const allowed = workIds ? new Set(workIds) : null
  return new Map(Object.values(rows).filter((row) => !allowed || allowed.has(row.personalWorkId)).map((row) => [row.personalWorkId, row]))
}

export async function ensureSynopsisForWork(work: SynopsisWorkRef, force = false): Promise<StoredSynopsisRecord> {
  const existing = await loadStoredSynopsis(work.id)
  if (!force && existing?.original && existing?.portuguese) return existing
  if (!force && existing?.status === 'missing_source') return existing

  if (!work.primaryMalId) {
    return persist({
      personalWorkId: work.id,
      malId: null,
      original: existing?.original ?? null,
      portuguese: existing?.portuguese ?? null,
      source: existing?.source ?? null,
      sourceLanguage: existing?.sourceLanguage ?? null,
      status: 'missing_source',
      lastError: 'No compatible MAL anime source is associated with this Personal Work.',
      fetchedAt: existing?.fetchedAt ?? new Date().toISOString(),
      translatedAt: existing?.translatedAt ?? null,
      storage: existing?.storage ?? 'local',
    })
  }

  let original = !force ? existing?.original ?? null : null
  let source = !force ? existing?.source ?? null : null
  let fetchedAt = existing?.fetchedAt ?? null
  if (!original) {
    const fetched = await fetchOriginal(work.primaryMalId)
    original = fetched.original
    source = fetched.source
    fetchedAt = new Date().toISOString()
  }
  if (!original) {
    return persist({
      personalWorkId: work.id,
      malId: work.primaryMalId,
      original: null,
      portuguese: null,
      source: null,
      sourceLanguage: null,
      status: 'missing_source',
      lastError: 'No trusted synopsis source returned content.',
      fetchedAt: fetchedAt ?? new Date().toISOString(),
      translatedAt: null,
      storage: 'local',
    })
  }

  let portuguese = !force ? existing?.portuguese ?? null : null
  let translationError: string | undefined
  let translatedAt = !force ? existing?.translatedAt ?? null : null
  if (!portuguese) {
    try {
      portuguese = await translationService.translate(original, 'en', 'pt-BR')
      translatedAt = new Date().toISOString()
    } catch (error) {
      translationError = error instanceof Error ? error.message : 'Automatic translation unavailable'
    }
  }

  return persist({
    personalWorkId: work.id,
    malId: work.primaryMalId,
    original,
    portuguese,
    source,
    sourceLanguage: 'en',
    status: portuguese ? 'complete' : 'original_only',
    lastError: translationError ?? null,
    translationError,
    fetchedAt: fetchedAt ?? new Date().toISOString(),
    translatedAt,
    storage: 'local',
  })
}

async function buildSynopsisBundle(malId: number): Promise<SynopsisBundle> {
  const work = findManagedWorkByMalId(malId)
  if (work) return ensureSynopsisForWork(work)

  const fetched = await fetchOriginal(malId)
  if (!fetched.original) return { original: null, portuguese: null, source: null, storage: 'memory' }
  try {
    return {
      original: fetched.original,
      portuguese: await translationService.translate(fetched.original, 'en', 'pt-BR'),
      source: fetched.source,
      storage: 'memory',
    }
  } catch (error) {
    return {
      original: fetched.original,
      portuguese: null,
      source: fetched.source,
      translationError: error instanceof Error ? error.message : 'Automatic translation unavailable',
      storage: 'memory',
    }
  }
}

export function loadSynopsisBundle(malId: number): Promise<SynopsisBundle> {
  const existing = synopsisCache.get(malId)
  if (existing) return existing

  const work = findManagedWorkByMalId(malId)
  const cached = work ? localRecord(work.id) : localRecordByMalId(malId)
  if (cached?.original) {
    const immediate = Promise.resolve(cached)
    synopsisCache.set(malId, immediate)
    if (work) {
      void loadRemote(work.id)
        .then((remote) => {
          if (remote) synopsisCache.set(malId, Promise.resolve(remote))
        })
        .catch(() => undefined)
    }
    return immediate
  }

  const pending = buildSynopsisBundle(malId).catch((error) => {
    synopsisCache.delete(malId)
    throw error
  })
  synopsisCache.set(malId, pending)
  return pending
}

export async function backfillPersonalCatalogSynopsis(
  onProgress?: (progress: SynopsisBackfillProgress) => void,
  signal?: AbortSignal,
): Promise<SynopsisBackfillProgress> {
  const snapshot = await loadMasterDataSnapshot()
  const works = snapshot.works
  const alreadyCached = works.filter((work) => work.synopsis.original && work.synopsis.ptBR).length
  const pending = works.filter((work) => !(work.synopsis.original && work.synopsis.ptBR) && work.synopsis.status !== 'missing_source')
  const progress: SynopsisBackfillProgress = {
    total: works.length,
    alreadyCached,
    processed: 0,
    succeeded: 0,
    missingSource: works.filter((work) => work.synopsis.status === 'missing_source').length,
    failed: 0,
  }

  for (const work of pending) {
    if (signal?.aborted) break
    progress.currentWork = work.displayName
    onProgress?.({ ...progress })
    try {
      const result = await ensureSynopsisForWork(work, false)
      if (result.storage !== 'supabase') throw new Error('Synopsis was not verified in Supabase.')
      if (result.status === 'complete' || result.status === 'original_only') progress.succeeded += 1
      else if (result.status === 'missing_source') progress.missingSource += 1
      else progress.failed += 1
    } catch (error) {
      progress.failed += 1
      console.error('AnimeFinder synopsis backfill item failed.', {
        operation: 'synopsis_backfill', entity: work.id, provider: 'jikan-compatible/anilist', error: error instanceof Error ? error.message : String(error),
      })
    }
    progress.processed += 1
    onProgress?.({ ...progress })
    await new Promise((resolve) => window.setTimeout(resolve, 700))
  }

  progress.currentWork = undefined
  onProgress?.({ ...progress })
  return progress
}
