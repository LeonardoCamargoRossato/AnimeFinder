export type AnimeStatus = 'Currently Airing' | 'Finished Airing' | 'Not yet aired' | string

export interface AnimeTitle {
  type: string
  title: string
}

export interface Anime {
  malId: number
  title: string
  titleEnglish?: string | null
  titleJapanese?: string | null
  titles: AnimeTitle[]
  imageUrl?: string | null
  largeImageUrl?: string | null
  score?: number | null
  episodes?: number | null
  type?: string | null
  year?: number | null
  status?: AnimeStatus | null
  genres: { id: number; name: string }[]
  synopsis?: string | null
  url?: string | null
  airedFrom?: string | null
  airedTo?: string | null
}

export interface Genre {
  id: number
  name: string
}

export interface AnimeFilterState {
  score_min?: number
  score_max?: number
  episodes_min?: number
  episodes_max?: number
  genres?: string[]
  year?: number
  type?: string
  status?: string
  watched?: boolean
}

export type MatchStatus = 'matched' | 'uncertain' | 'unmatched' | 'manually_confirmed'

export interface WatchedAnime {
  id?: number | string
  mal_id: number | null
  title_original: string
  title_portuguese?: string | null
  title_english?: string | null
  title_romaji?: string | null
  title_japanese?: string | null
  title_chinese?: string | null
  match_status: MatchStatus
  created_at?: string
  updated_at?: string
}

export interface ImportCandidate {
  key: string
  originalTitle: string
  match?: Anime | null
  alternatives?: Anime[]
  status: MatchStatus
  loading?: boolean
}

export const emptyFilters: AnimeFilterState = {}

export function normalizeTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function animeMatchesFilters(
  anime: Anime,
  filters: AnimeFilterState,
  watchedIds: Set<number>,
): boolean {
  if (filters.score_min != null && (anime.score ?? 0) < filters.score_min) return false
  if (filters.score_max != null && (anime.score ?? Number.POSITIVE_INFINITY) > filters.score_max) return false
  if (filters.episodes_min != null && (anime.episodes ?? 0) < filters.episodes_min) return false
  if (filters.episodes_max != null && (anime.episodes ?? Number.POSITIVE_INFINITY) > filters.episodes_max) return false
  if (filters.year != null && anime.year !== filters.year) return false
  if (filters.type && anime.type !== filters.type) return false
  if (filters.status && anime.status !== filters.status) return false
  if (filters.genres?.length) {
    const available = new Set(anime.genres.map((genre) => genre.name))
    if (!filters.genres.every((genre) => available.has(genre))) return false
  }
  if (filters.watched === false && watchedIds.has(anime.malId)) return false
  if (filters.watched === true && !watchedIds.has(anime.malId)) return false
  return true
}
