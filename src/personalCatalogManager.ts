import type { Anime, WatchedAnime } from './types'
import { personalCatalogRepository, type PersonalCatalogCategory, type PersonalCatalogItem } from './personalCatalog'
import { supabase } from './supabase'

export type PersonalWatchStatus = 'watched' | 'watching' | 'unfinished' | 'dropped' | 'planned' | 'unknown'

export interface ManagedCatalogWork extends PersonalCatalogItem {
  id: string
  displayName: string
  primaryMalId: number | null
  watchStatus: PersonalWatchStatus
  associationMalIds: number[]
  posterUrl?: string | null
  pending?: boolean
  source: 'snapshot' | 'dynamic'
}

export interface ManagedCatalogState {
  dynamicWorks: ManagedCatalogWork[]
  savedAt?: string
}

const STORAGE_KEY = 'animefinder.personalCatalog.dynamic.v0'
const DRAFT_KEY = 'animefinder.personalCatalog.draft.v0'

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

export function normalizePersonalWorkName(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function statusForCategory(category: PersonalCatalogCategory): PersonalWatchStatus {
  if (category === 'watched' || category === 'movies') return 'watched'
  if (category === 'dropped-unfinished') return 'unfinished'
  if (category === 'new-seasons-2026') return 'planned'
  return 'unknown'
}

function stableSnapshotId(item: PersonalCatalogItem, index: number) {
  return `snapshot:${item.category}:${item.malId ?? normalizePersonalWorkName(item.anime) || index}`
}

function snapshotWorks(): ManagedCatalogWork[] {
  const result: ManagedCatalogWork[] = []
  let index = 0
  for (const category of ['watched', 'movies', 'manhua', 'dropped-unfinished', 'new-seasons-2026', 'needs-classification'] as PersonalCatalogCategory[]) {
    for (const item of personalCatalogRepository.list(category)) {
      result.push({
        ...item,
        id: stableSnapshotId(item, index++),
        displayName: item.anime,
        primaryMalId: item.malId,
        watchStatus: statusForCategory(item.category),
        associationMalIds: item.malId == null ? [] : [item.malId],
        source: 'snapshot',
      })
    }
  }
  return result
}

export function readDynamicCatalogState(): ManagedCatalogState {
  return safeParse<ManagedCatalogState>(localStorage.getItem(STORAGE_KEY), { dynamicWorks: [] })
}

export function readDraftCatalogState(): ManagedCatalogState | null {
  return safeParse<ManagedCatalogState | null>(sessionStorage.getItem(DRAFT_KEY), null)
}

export function writeDraftCatalogState(dynamicWorks: ManagedCatalogWork[]) {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ dynamicWorks }))
}

export function clearDraftCatalogState() {
  sessionStorage.removeItem(DRAFT_KEY)
}

function writeLocalState(dynamicWorks: ManagedCatalogWork[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ dynamicWorks: dynamicWorks.map((work) => ({ ...work, pending: false, source: 'dynamic' as const })), savedAt: new Date().toISOString() }))
}

function mergeWorks(dynamicWorks: ManagedCatalogWork[]) {
  const merged = new Map<string, ManagedCatalogWork>()
  for (const work of snapshotWorks()) merged.set(work.id, work)
  for (const work of dynamicWorks) merged.set(work.id, { ...work, source: 'dynamic' })
  return Array.from(merged.values())
}

export function listManagedCatalogWorks(draft?: ManagedCatalogWork[]): ManagedCatalogWork[] {
  return mergeWorks(draft ?? readDynamicCatalogState().dynamicWorks)
}

export function listManagedCategory(category: PersonalCatalogCategory, draft?: ManagedCatalogWork[]) {
  return listManagedCatalogWorks(draft)
    .filter((work) => work.category === category)
    .sort((a, b) => {
      if (category === 'watched') return (a.myRanked ?? Number.MAX_SAFE_INTEGER) - (b.myRanked ?? Number.MAX_SAFE_INTEGER)
      return a.displayName.localeCompare(b.displayName)
    })
}

export function createManagedWorkFromAnime(anime: Anime, displayName: string, category: PersonalCatalogCategory, rank: number | null): ManagedCatalogWork {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `local-${Date.now()}-${anime.malId}`
  return {
    id,
    displayName: displayName.trim() || anime.title,
    anime: displayName.trim() || anime.title,
    primaryMalId: anime.malId,
    malId: anime.malId,
    malUrl: anime.url ?? `https://myanimelist.net/anime/${anime.malId}`,
    malScore: anime.score ?? null,
    originalObservations: null,
    comments: null,
    englishName: anime.titleEnglish ?? null,
    originalName: anime.titleJapanese ?? null,
    myRanked: rank,
    watched: category === 'watched' || category === 'movies',
    watchStatus: statusForCategory(category),
    category,
    associationMalIds: [anime.malId],
    posterUrl: anime.imageUrl ?? anime.largeImageUrl ?? null,
    pending: true,
    source: 'dynamic',
  }
}

export function normalizeRanks(works: ManagedCatalogWork[]) {
  return works.map((work, index) => ({ ...work, myRanked: index + 1 }))
}

export function upsertDynamicWork(dynamicWorks: ManagedCatalogWork[], work: ManagedCatalogWork) {
  const next = new Map(dynamicWorks.map((item) => [item.id, item]))
  next.set(work.id, { ...work, source: 'dynamic' })
  return Array.from(next.values())
}

export function captureCategoryOverrides(dynamicWorks: ManagedCatalogWork[], visibleWorks: ManagedCatalogWork[]) {
  let next = dynamicWorks
  for (const work of visibleWorks) next = upsertDynamicWork(next, { ...work, source: 'dynamic' })
  return next
}

export function findManagedWorkByMalId(malId: number, draft?: ManagedCatalogWork[]): ManagedCatalogWork | null {
  return listManagedCatalogWorks(draft).find((work) => work.primaryMalId === malId || work.associationMalIds.includes(malId)) ?? null
}

export function findPotentialDuplicate(anime: Anime, displayName: string, draft?: ManagedCatalogWork[]) {
  const normalized = normalizePersonalWorkName(displayName)
  return listManagedCatalogWorks(draft).find((work) =>
    work.primaryMalId === anime.malId
    || work.associationMalIds.includes(anime.malId)
    || normalizePersonalWorkName(work.displayName) === normalized,
  ) ?? null
}

export function getManagedWatchedMalIds(draft?: ManagedCatalogWork[]): Set<number> {
  const ids = new Set<number>()
  for (const work of listManagedCatalogWorks(draft)) {
    if (work.watchStatus !== 'watched') continue
    if (work.primaryMalId != null) ids.add(work.primaryMalId)
    work.associationMalIds.forEach((id) => ids.add(id))
  }
  return ids
}

export function isManagedMalIdWatched(malId: number) {
  return getManagedWatchedMalIds().has(malId)
}

export function managedWatchedRows(): WatchedAnime[] {
  const rows: WatchedAnime[] = []
  for (const work of listManagedCatalogWorks()) {
    if (work.watchStatus !== 'watched') continue
    const ids = new Set(work.associationMalIds)
    if (work.primaryMalId != null) ids.add(work.primaryMalId)
    ids.forEach((malId) => rows.push({
      id: `managed-${work.id}-${malId}`,
      mal_id: malId,
      title_original: work.displayName,
      title_english: work.englishName,
      title_romaji: work.displayName,
      title_japanese: work.originalName,
      title_portuguese: null,
      title_chinese: null,
      match_status: 'manually_confirmed',
    }))
  }
  return rows
}

export function associateMalIdLocally(workId: string, malId: number): ManagedCatalogWork[] {
  const dynamicWorks = readDynamicCatalogState().dynamicWorks
  const source = listManagedCatalogWorks(dynamicWorks).find((work) => work.id === workId)
  if (!source) return dynamicWorks
  const override: ManagedCatalogWork = {
    ...source,
    associationMalIds: Array.from(new Set([...source.associationMalIds, malId])),
    source: 'dynamic',
  }
  const next = upsertDynamicWork(dynamicWorks, override)
  writeLocalState(next)
  return next
}

async function currentUserId() {
  if (!supabase) return null
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

export async function saveManagedCatalog(dynamicWorks: ManagedCatalogWork[]): Promise<'supabase' | 'local'> {
  const clean = dynamicWorks.map((work) => ({ ...work, pending: false, source: 'dynamic' as const }))
  writeLocalState(clean)
  clearDraftCatalogState()

  if (!supabase) return 'local'
  const userId = await currentUserId()
  if (!userId) return 'local'

  const payload = clean.map((work) => ({
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

  const { error } = await supabase.rpc('save_personal_catalog_batch', { p_works: payload })
  if (error) return 'local'
  return 'supabase'
}

export async function associateExternalEntry(work: ManagedCatalogWork, malId: number): Promise<'supabase' | 'local'> {
  const dynamic = associateMalIdLocally(work.id, malId)
  return saveManagedCatalog(dynamic)
}

export async function createAndSaveManagedWork(anime: Anime, displayName: string, category: PersonalCatalogCategory = 'watched') {
  const rank = category === 'watched' ? listManagedCategory('watched').length + 1 : null
  const work = createManagedWorkFromAnime(anime, displayName, category, rank)
  const next = upsertDynamicWork(readDynamicCatalogState().dynamicWorks, work)
  await saveManagedCatalog(next)
  return work
}
