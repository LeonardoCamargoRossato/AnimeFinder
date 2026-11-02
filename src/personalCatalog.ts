import type { Anime } from './types'
import { animeProvider } from './providers'
import { supabase } from './supabase'
import watched1 from './catalog-data/watched-1'
import watched2 from './catalog-data/watched-2'
import watched3 from './catalog-data/watched-3'
import watched4 from './catalog-data/watched-4'
import other from './catalog-data/other'

export type PersonalCatalogCategory =
  | 'watched'
  | 'movies'
  | 'manhua'
  | 'dropped-unfinished'
  | 'new-seasons-2026'
  | 'needs-classification'

interface RawPersonalCatalogItem {
  anime: string
  malUrl: string | null
  malId: number | null
  malScore: number | null
  observations?: string | null
  originalObservations?: string | null
  englishName: string | null
  originalName: string | null
  myRanked: number | null
  category: PersonalCatalogCategory
}

export interface PersonalCatalogItem {
  anime: string
  malUrl: string | null
  malId: number | null
  malScore: number | null
  originalObservations: string | null
  comments: string | null
  englishName: string | null
  originalName: string | null
  myRanked: number | null
  watched: boolean
  category: PersonalCatalogCategory
}

export const personalCatalogCategories: { id: PersonalCatalogCategory; label: string }[] = [
  { id: 'watched', label: 'Watched' },
  { id: 'movies', label: 'Movies' },
  { id: 'manhua', label: 'Manhua' },
  { id: 'needs-classification', label: 'Needs Classification' },
  { id: 'dropped-unfinished', label: 'Dropped / Unfinished' },
  { id: 'new-seasons-2026', label: 'New Seasons 2026' },
]

// Historical bootstrap data only. Runtime catalog truth is Supabase.
const rawSnapshot = [...watched1, ...watched2, ...watched3, ...watched4, ...other] as RawPersonalCatalogItem[]
const legacySnapshot: PersonalCatalogItem[] = rawSnapshot.map((item) => ({
  anime: item.anime,
  malUrl: item.malUrl,
  malId: item.malId,
  malScore: item.malScore,
  originalObservations: item.originalObservations ?? item.observations ?? null,
  comments: null,
  englishName: item.englishName,
  originalName: item.originalName,
  myRanked: item.myRanked,
  watched: item.category === 'watched',
  category: item.category,
}))

const metadataPromises = new Map<number, Promise<Anime>>()
const metadataMemory = new Map<number, Anime>()

function normalize(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

async function findWorkForMalId(malId: number) {
  if (!supabase) return null
  let result = await supabase.from('personal_catalog_works')
    .select('id,display_name,primary_mal_id,mal_score,english_name,original_name,poster_url,mal_url')
    .eq('primary_mal_id', malId)
    .maybeSingle()
  if (!result.data && !result.error) {
    result = await supabase.from('personal_catalog_works')
      .select('id,display_name,primary_mal_id,mal_score,english_name,original_name,poster_url,mal_url')
      .contains('association_mal_ids', [malId])
      .limit(1)
      .maybeSingle()
  }
  if (result.error) throw new Error(result.error.message)
  return result.data
}

function animeFromPersisted(malId: number, work: any, meta: any): Anime | null {
  const genres = Array.isArray(meta?.genres) ? meta.genres.map((name: unknown, index: number) => ({ id: index + 1, name: String(name) })) : []
  if (!genres.length && !meta?.poster_url && !work?.poster_url) return null
  const title = meta?.title_default ?? work?.display_name ?? `MAL #${malId}`
  return {
    malId,
    title,
    titleEnglish: meta?.title_english ?? work?.english_name ?? null,
    titleJapanese: meta?.title_japanese ?? work?.original_name ?? null,
    titles: [
      { type: 'Default', title },
      ...(meta?.title_english ? [{ type: 'English', title: meta.title_english }] : []),
      ...(meta?.title_japanese ? [{ type: 'Japanese', title: meta.title_japanese }] : []),
    ],
    imageUrl: meta?.poster_url ?? work?.poster_url ?? null,
    largeImageUrl: meta?.poster_url ?? work?.poster_url ?? null,
    score: meta?.mal_score == null ? work?.mal_score ?? null : Number(meta.mal_score),
    episodes: meta?.episodes == null ? null : Number(meta.episodes),
    type: meta?.media_type ?? null,
    year: meta?.year == null ? null : Number(meta.year),
    status: meta?.anime_status ?? null,
    genres,
    synopsis: null,
    url: work?.mal_url ?? `https://myanimelist.net/anime/${malId}`,
    source: meta?.source_type ?? null,
    studios: meta?.studio ? [{ id: 0, name: String(meta.studio) }] : [],
  }
}

async function loadPersistedMetadata(malId: number): Promise<Anime | null> {
  if (!supabase) return null
  const work = await findWorkForMalId(malId)
  if (!work) return null
  const { data, error } = await supabase.from('personal_work_external_metadata')
    .select('genres,metadata_provider,metadata_fetched_at,mal_score,title_default,title_english,title_japanese,poster_url,year,media_type,episodes,anime_status,studio,source_type')
    .eq('personal_work_id', work.id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return animeFromPersisted(malId, work, data)
}

async function persistMetadata(workId: string, anime: Anime) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { error } = await supabase.rpc('save_work_external_metadata', {
    p_work_id: workId,
    p_mal_id: anime.malId,
    p_genres: anime.genres.map((row) => row.name),
    p_provider: 'jikan-compatible',
    p_mal_score: anime.score ?? null,
    p_title_default: anime.title,
    p_title_english: anime.titleEnglish ?? null,
    p_title_japanese: anime.titleJapanese ?? null,
    p_poster_url: anime.largeImageUrl ?? anime.imageUrl ?? null,
    p_year: anime.year ?? null,
    p_media_type: anime.type ?? null,
    p_episodes: anime.episodes ?? null,
    p_anime_status: anime.status ?? null,
    p_studio: anime.studios?.[0]?.name ?? null,
    p_source_type: anime.source ?? null,
  })
  if (error) throw new Error(`Metadata persistence failed: ${error.message}`)
}

async function ensureMetadata(malId: number): Promise<Anime> {
  const persisted = await loadPersistedMetadata(malId)
  if (persisted?.genres.length) return persisted
  const work = await findWorkForMalId(malId)
  if (!work) throw new Error('This MAL entry is not associated with a Supabase Personal Work.')
  const fetched = await animeProvider.getAnime(malId)
  await persistMetadata(work.id, fetched)
  const verified = await loadPersistedMetadata(malId)
  if (!verified) throw new Error('Metadata read-back failed after persistence.')
  return { ...fetched, ...verified, genres: verified.genres.length ? verified.genres : fetched.genres }
}

export const personalCatalogRepository = {
  /** Legacy migration source only. Runtime UI must use personalCatalogManager/Supabase. */
  list(category: PersonalCatalogCategory): PersonalCatalogItem[] { return legacySnapshot.filter((item) => item.category === category) },
  search(category: PersonalCatalogCategory, query: string): PersonalCatalogItem[] {
    const term = normalize(query.trim())
    return this.list(category).filter((item) => !term || normalize([item.anime,item.englishName,item.originalName,item.originalObservations].filter(Boolean).join(' ')).includes(term))
  },
  findByMalId(malId: number): PersonalCatalogItem | null { return legacySnapshot.find((item) => item.malId === malId) ?? null },
  isWatched(malId: number): boolean { return legacySnapshot.some((item) => item.category === 'watched' && item.malId === malId) },
  watchedCount(): number { return legacySnapshot.filter((item) => item.category === 'watched').length },
  watchedMalIds(): Set<number> { return new Set(legacySnapshot.filter((item) => item.category === 'watched' && item.malId != null).map((item) => item.malId as number)) },
  getCachedMetadata(malId: number): Anime | null { return metadataMemory.get(malId) ?? null },
  getMetadata(malId: number): Promise<Anime> {
    const resolved = metadataMemory.get(malId)
    if (resolved) return Promise.resolve(resolved)
    const pending = metadataPromises.get(malId)
    if (pending) return pending
    const request = ensureMetadata(malId)
      .then((anime) => { metadataMemory.set(malId, anime); return anime })
      .finally(() => metadataPromises.delete(malId))
    metadataPromises.set(malId, request)
    return request
  },
  count(): number { return legacySnapshot.length },
}

export function legacyPersonalCatalogSnapshot() { return legacySnapshot.map((row) => ({ ...row })) }
