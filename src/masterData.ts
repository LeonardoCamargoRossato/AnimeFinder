import { animeProvider } from './providers'
import { listManagedCatalogWorks } from './personalCatalogManager'
import type { PersonalCatalogCategory } from './personalCatalog'
import { isSupabaseConfigured, supabase } from './supabase'

export interface MasterExternalSourceProjection {
  externalId: string
  canonicalName: string
  url?: string | null
  imageUrl?: string | null
  metadata?: Record<string, unknown>
  confirmed?: boolean
  lastSyncedAt?: string | null
}

export interface MasterCharacterProjection {
  id?: string
  rank: number
  name: string
  comment: string
  keywords: string[]
  externalSources: {
    jikan?: MasterExternalSourceProjection
    fandom?: MasterExternalSourceProjection
  }
}

export interface MasterSynopsisProjection {
  original: string | null
  ptBR: string | null
  provider: string | null
  sourceLanguage: string | null
  fetchedAt: string | null
  translatedAt: string | null
  status: 'complete' | 'original_only' | 'missing_source' | 'failed' | null
  lastError: string | null
}

export interface MasterDataAuditFlags {
  hasMalId: boolean
  hasGenres: boolean
  hasSynopsisOriginal: boolean
  hasSynopsisPtBr: boolean
  hasPersonalComment: boolean
  hasKeywords: boolean
  hasCharacters: boolean
  hasCharacterExternalLinks: boolean
}

export interface MasterDataWork {
  id: string
  displayName: string
  primaryMalId: number | null
  category: PersonalCatalogCategory
  watchStatus: string
  myRanked: number | null
  originalObservations: string | null
  comment: string
  posterUrl: string | null
  malScore: number | null
  englishName: string | null
  originalName: string | null
  malUrl: string | null
  associationMalIds: number[]
  keywords: string[]
  genres: string[]
  metadataProvider: string | null
  metadataFetchedAt: string | null
  synopsis: MasterSynopsisProjection
  characterKnowledge: MasterCharacterProjection[]
  audit: MasterDataAuditFlags
}

export interface MasterDataSnapshot {
  source: 'supabase'
  generatedAt: string
  totalWorks: number
  categoryCounts: Record<string, number>
  works: MasterDataWork[]
}

export interface CatalogIntegrityAudit {
  databaseCount: number
  frontendReferenceCount: number
  missingInDatabase: string[]
  extraInDatabase: string[]
}

export interface MetadataBackfillProgress {
  total: number
  alreadyPersisted: number
  processed: number
  succeeded: number
  missingSource: number
  failed: number
  currentWork?: string
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function normalizeCharacter(row: any): MasterCharacterProjection {
  const sources = row?.externalSources && typeof row.externalSources === 'object' ? row.externalSources : {}
  return {
    id: typeof row?.id === 'string' ? row.id : undefined,
    rank: Number(row?.rank) || 1,
    name: String(row?.name ?? ''),
    comment: String(row?.comment ?? ''),
    keywords: asArray<string>(row?.keywords).map(String),
    externalSources: {
      jikan: sources.jikan ? { ...sources.jikan, externalId: String(sources.jikan.externalId ?? '') } : undefined,
      fandom: sources.fandom ? { ...sources.fandom, externalId: String(sources.fandom.externalId ?? '') } : undefined,
    },
  }
}

function normalizeWork(row: any): MasterDataWork {
  const synopsis = row?.synopsis ?? {}
  const audit = row?.audit ?? {}
  return {
    id: String(row?.id ?? ''),
    displayName: String(row?.displayName ?? ''),
    primaryMalId: row?.primaryMalId == null ? null : Number(row.primaryMalId),
    category: row?.category as PersonalCatalogCategory,
    watchStatus: String(row?.watchStatus ?? 'unknown'),
    myRanked: row?.myRanked == null ? null : Number(row.myRanked),
    originalObservations: row?.originalObservations ?? null,
    comment: String(row?.comment ?? ''),
    posterUrl: row?.posterUrl ?? null,
    malScore: row?.malScore == null ? null : Number(row.malScore),
    englishName: row?.englishName ?? null,
    originalName: row?.originalName ?? null,
    malUrl: row?.malUrl ?? null,
    associationMalIds: asArray<number>(row?.associationMalIds).map(Number).filter(Number.isFinite),
    keywords: asArray<string>(row?.keywords).map(String),
    genres: asArray<string>(row?.genres).map(String),
    metadataProvider: row?.metadataProvider ?? null,
    metadataFetchedAt: row?.metadataFetchedAt ?? null,
    synopsis: {
      original: synopsis.original ?? null,
      ptBR: synopsis.ptBR ?? null,
      provider: synopsis.provider ?? null,
      sourceLanguage: synopsis.sourceLanguage ?? null,
      fetchedAt: synopsis.fetchedAt ?? null,
      translatedAt: synopsis.translatedAt ?? null,
      status: synopsis.status ?? null,
      lastError: synopsis.lastError ?? null,
    },
    characterKnowledge: asArray<any>(row?.characterKnowledge).map(normalizeCharacter),
    audit: {
      hasMalId: Boolean(audit.hasMalId),
      hasGenres: Boolean(audit.hasGenres),
      hasSynopsisOriginal: Boolean(audit.hasSynopsisOriginal),
      hasSynopsisPtBr: Boolean(audit.hasSynopsisPtBr),
      hasPersonalComment: Boolean(audit.hasPersonalComment),
      hasKeywords: Boolean(audit.hasKeywords),
      hasCharacters: Boolean(audit.hasCharacters),
      hasCharacterExternalLinks: Boolean(audit.hasCharacterExternalLinks),
    },
  }
}

function migrationHint(message: string) {
  const lower = message.toLowerCase()
  if (lower.includes('get_master_data_snapshot') || lower.includes('personal_work_external_metadata') || lower.includes('pgrst202')) {
    return ' Run supabase/data-integrity-master-v4.sql in the AnimeFinder Supabase SQL Editor.'
  }
  return ''
}

export async function loadMasterDataSnapshot(): Promise<MasterDataSnapshot> {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured. Master Data Table requires the database source of truth.')
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error('Sign in before loading Master Data from Supabase.')

  const { data, error } = await supabase.rpc('get_master_data_snapshot')
  if (error) {
    console.error('AnimeFinder Master Data RPC failed.', { operation: 'get_master_data_snapshot', code: error.code, message: error.message })
    throw new Error(`Could not load the Supabase Master Data snapshot.${migrationHint(error.message)}`)
  }

  const payload = (data ?? {}) as any
  const works = asArray<any>(payload.works).map(normalizeWork)
  const categoryCounts = payload.categoryCounts && typeof payload.categoryCounts === 'object'
    ? Object.fromEntries(Object.entries(payload.categoryCounts).map(([key, value]) => [key, Number(value) || 0]))
    : {}

  return {
    source: 'supabase',
    generatedAt: String(payload.generatedAt ?? new Date().toISOString()),
    totalWorks: Number(payload.totalWorks) || works.length,
    categoryCounts,
    works,
  }
}

export function auditCatalogIntegrity(snapshot: MasterDataSnapshot): CatalogIntegrityAudit {
  const frontend = listManagedCatalogWorks()
  const databaseIds = new Set(snapshot.works.map((work) => work.id))
  const frontendIds = new Set(frontend.map((work) => work.id))
  return {
    databaseCount: snapshot.works.length,
    frontendReferenceCount: frontend.length,
    missingInDatabase: frontend.filter((work) => !databaseIds.has(work.id)).map((work) => work.id),
    extraInDatabase: snapshot.works.filter((work) => !frontendIds.has(work.id)).map((work) => work.id),
  }
}

export async function syncMissingCatalogWorksToSupabase(snapshot: MasterDataSnapshot) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const databaseIds = new Set(snapshot.works.map((work) => work.id))
  const missing = listManagedCatalogWorks().filter((work) => !databaseIds.has(work.id))
  if (!missing.length) return 0

  const payload = missing.map((work) => ({
    id: work.id,
    display_name: work.displayName,
    primary_mal_id: work.primaryMalId,
    category: work.category,
    watch_status: work.watchStatus,
    my_ranked: work.myRanked,
    original_observations: work.originalObservations,
    comments: work.comments,
    poster_url: work.posterUrl ?? null,
    mal_score: work.malScore,
    english_name: work.englishName,
    original_name: work.originalName,
    mal_url: work.malUrl,
    association_mal_ids: work.associationMalIds,
  }))

  const { data, error } = await supabase.rpc('insert_missing_personal_catalog_works', { p_works: payload })
  if (error) {
    console.error('AnimeFinder catalog bootstrap failed.', { operation: 'insert_missing_personal_catalog_works', code: error.code, message: error.message })
    throw new Error(`Could not import missing Personal Works into Supabase.${migrationHint(error.message)}`)
  }
  return Number(data) || 0
}

async function persistGenres(work: MasterDataWork, genres: string[]) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data: userData, error: userError } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (userError || !userId) throw new Error('Authentication required.')

  const timestamp = new Date().toISOString()
  const { error } = await supabase.from('personal_work_external_metadata').upsert({
    user_id: userId,
    personal_work_id: work.id,
    mal_id: work.primaryMalId,
    genres,
    metadata_provider: 'jikan-compatible',
    metadata_fetched_at: timestamp,
    updated_at: timestamp,
  }, { onConflict: 'user_id,personal_work_id' })
  if (error) throw new Error(error.message)

  const { data: readBack, error: readError } = await supabase.from('personal_work_external_metadata')
    .select('genres,metadata_provider,metadata_fetched_at')
    .eq('user_id', userId)
    .eq('personal_work_id', work.id)
    .maybeSingle()
  if (readError || !readBack) throw new Error(readError?.message ?? 'Genre metadata read-back failed.')
  const persisted = asArray<string>(readBack.genres).map(String)
  if (persisted.join('\u0000') !== genres.join('\u0000')) throw new Error('Genre metadata read-back did not match the written value.')
}

export async function backfillPersistedGenres(
  snapshot: MasterDataSnapshot,
  onProgress?: (progress: MetadataBackfillProgress) => void,
  signal?: AbortSignal,
): Promise<MetadataBackfillProgress> {
  const candidates = snapshot.works.filter((work) => work.primaryMalId != null)
  const alreadyPersisted = candidates.filter((work) => work.genres.length > 0).length
  const pending = candidates.filter((work) => work.genres.length === 0)
  const progress: MetadataBackfillProgress = {
    total: candidates.length,
    alreadyPersisted,
    processed: 0,
    succeeded: 0,
    missingSource: 0,
    failed: 0,
  }

  for (const work of pending) {
    if (signal?.aborted) break
    progress.currentWork = work.displayName
    onProgress?.({ ...progress })
    try {
      const anime = await animeProvider.getAnime(work.primaryMalId!)
      const genres = anime.genres.map((genre) => genre.name).filter(Boolean)
      if (!genres.length) progress.missingSource += 1
      else {
        await persistGenres(work, genres)
        progress.succeeded += 1
      }
    } catch (error) {
      progress.failed += 1
      console.error('AnimeFinder genre backfill failed.', {
        operation: 'metadata_backfill',
        entity: work.id,
        provider: 'jikan-compatible',
        error: error instanceof Error ? error.message : String(error),
      })
    }
    progress.processed += 1
    onProgress?.({ ...progress })
    await new Promise((resolve) => window.setTimeout(resolve, 650))
  }

  progress.currentWork = undefined
  onProgress?.({ ...progress })
  return progress
}

export function characterKnowledgeJson(snapshot: MasterDataSnapshot, workId: string) {
  return snapshot.works.find((work) => work.id === workId)?.characterKnowledge ?? []
}

export function masterWorkByMalId(snapshot: MasterDataSnapshot, malId: number) {
  return snapshot.works.find((work) => work.primaryMalId === malId || work.associationMalIds.includes(malId)) ?? null
}
