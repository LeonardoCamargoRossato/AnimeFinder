import type { Anime, Genre } from './types'

export interface AnimeProvider {
  readonly id: string
  readonly name: string
  searchAnime(query: string, page?: number): Promise<Anime[]>
  getAnime(id: number): Promise<Anime>
  getTopAnime(page?: number): Promise<Anime[]>
  getSeasonAnime(year?: number, season?: 'winter' | 'spring' | 'summer' | 'fall'): Promise<Anime[]>
  getGenres(): Promise<Genre[]>
}

// -----------------------------------------------------------------------------
// AniList provider
// -----------------------------------------------------------------------------
// The public Jikan API was discontinued on 2026-10-01. AnimeFinder now uses
// AniList for discovery metadata while preserving MyAnimeList IDs (idMal) as
// the application's canonical external identifier whenever one is available.
// This keeps the existing Supabase watched_anime schema and MAL links intact.

type AniListDate = { year?: number | null; month?: number | null; day?: number | null }
type AniListTitle = { romaji?: string | null; english?: string | null; native?: string | null }
type AniListCover = { medium?: string | null; large?: string | null; extraLarge?: string | null }
type AniListMedia = {
  id: number
  idMal?: number | null
  title: AniListTitle
  coverImage?: AniListCover | null
  averageScore?: number | null
  episodes?: number | null
  format?: string | null
  seasonYear?: number | null
  status?: string | null
  genres?: string[] | null
  description?: string | null
  startDate?: AniListDate | null
  endDate?: AniListDate | null
}

type GraphQlResponse<T> = {
  data?: T
  errors?: Array<{ message?: string }>
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function genreId(name: string) {
  let hash = 0
  for (let index = 0; index < name.length; index += 1) hash = ((hash << 5) - hash + name.charCodeAt(index)) | 0
  return Math.abs(hash) || 1
}

function cleanDescription(value?: string | null) {
  if (!value) return null
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

function isoDate(value?: AniListDate | null) {
  if (!value?.year) return null
  const month = String(value.month ?? 1).padStart(2, '0')
  const day = String(value.day ?? 1).padStart(2, '0')
  return `${value.year}-${month}-${day}`
}

function mapFormat(format?: string | null) {
  const formats: Record<string, string> = {
    TV: 'TV',
    TV_SHORT: 'TV',
    MOVIE: 'Movie',
    SPECIAL: 'Special',
    OVA: 'OVA',
    ONA: 'ONA',
    MUSIC: 'Music',
  }
  return format ? formats[format] ?? format : null
}

function mapStatus(status?: string | null) {
  const statuses: Record<string, string> = {
    FINISHED: 'Finished Airing',
    RELEASING: 'Currently Airing',
    NOT_YET_RELEASED: 'Not yet aired',
    CANCELLED: 'Cancelled',
    HIATUS: 'On Hiatus',
  }
  return status ? statuses[status] ?? status : null
}

function currentAnimeSeason(): 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL' {
  const month = new Date().getMonth() + 1
  if (month <= 3) return 'WINTER'
  if (month <= 6) return 'SPRING'
  if (month <= 9) return 'SUMMER'
  return 'FALL'
}

const MEDIA_FIELDS = `
  id
  idMal
  title { romaji english native }
  coverImage { medium large extraLarge }
  averageScore
  episodes
  format
  seasonYear
  status
  genres
  description(asHtml: false)
  startDate { year month day }
  endDate { year month day }
`

export class AniListProvider implements AnimeProvider {
  readonly id = 'anilist'
  readonly name = 'AniList'
  private readonly endpoint = 'https://graphql.anilist.co'

  private async request<T>(query: string, variables: Record<string, unknown> = {}, retry = true): Promise<T> {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 12000)

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      })

      if (response.status === 429 && retry) {
        await wait(1000)
        return this.request<T>(query, variables, false)
      }

      if (!response.ok) throw new Error(`Anime provider error (${response.status})`)

      const payload = (await response.json()) as GraphQlResponse<T>
      if (payload.errors?.length) throw new Error(payload.errors[0]?.message || 'Anime provider returned an error')
      if (!payload.data) throw new Error('Anime provider returned no data')
      return payload.data
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('Anime provider timed out. Please try again.')
      }
      throw error
    } finally {
      window.clearTimeout(timeout)
    }
  }

  private mapAnime(item: AniListMedia): Anime | null {
    // AnimeFinder intentionally keeps MAL ID as the cross-provider identity.
    if (!item.idMal) return null

    const primaryTitle = item.title.romaji || item.title.english || item.title.native || `Anime #${item.idMal}`
    const titles = [
      item.title.romaji ? { type: 'Romaji', title: item.title.romaji } : null,
      item.title.english ? { type: 'English', title: item.title.english } : null,
      item.title.native ? { type: 'Japanese', title: item.title.native } : null,
    ].filter((title): title is { type: string; title: string } => Boolean(title))

    return {
      malId: item.idMal,
      title: primaryTitle,
      titleEnglish: item.title.english,
      titleJapanese: item.title.native,
      titles: titles.length ? titles : [{ type: 'Default', title: primaryTitle }],
      imageUrl: item.coverImage?.large || item.coverImage?.medium || undefined,
      largeImageUrl: item.coverImage?.extraLarge || item.coverImage?.large || undefined,
      score: item.averageScore != null ? item.averageScore / 10 : null,
      episodes: item.episodes,
      type: mapFormat(item.format),
      year: item.seasonYear ?? item.startDate?.year ?? null,
      status: mapStatus(item.status),
      genres: (item.genres ?? []).map((name) => ({ id: genreId(name), name })),
      synopsis: cleanDescription(item.description),
      url: `https://myanimelist.net/anime/${item.idMal}`,
      airedFrom: isoDate(item.startDate),
      airedTo: isoDate(item.endDate),
    }
  }

  private mapMany(items: AniListMedia[]) {
    return items.map((item) => this.mapAnime(item)).filter((item): item is Anime => item !== null)
  }

  async searchAnime(query: string, page = 1): Promise<Anime[]> {
    const data = await this.request<{ Page: { media: AniListMedia[] } }>(
      `query SearchAnime($page: Int, $search: String) {
        Page(page: $page, perPage: 24) {
          media(search: $search, type: ANIME, isAdult: false, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
            ${MEDIA_FIELDS}
          }
        }
      }`,
      { page, search: query },
    )
    return this.mapMany(data.Page.media)
  }

  async getAnime(id: number): Promise<Anime> {
    const data = await this.request<{ Media: AniListMedia | null }>(
      `query AnimeByMalId($malId: Int) {
        Media(idMal: $malId, type: ANIME) {
          ${MEDIA_FIELDS}
        }
      }`,
      { malId: id },
    )
    if (!data.Media) throw new Error('Anime not found in the active provider.')
    const anime = this.mapAnime(data.Media)
    if (!anime) throw new Error('This anime does not have a MyAnimeList ID.')
    return anime
  }

  async getTopAnime(page = 1): Promise<Anime[]> {
    const data = await this.request<{ Page: { media: AniListMedia[] } }>(
      `query PopularAnime($page: Int) {
        Page(page: $page, perPage: 24) {
          media(type: ANIME, isAdult: false, sort: [POPULARITY_DESC, SCORE_DESC]) {
            ${MEDIA_FIELDS}
          }
        }
      }`,
      { page },
    )
    return this.mapMany(data.Page.media)
  }

  async getSeasonAnime(year?: number, season?: 'winter' | 'spring' | 'summer' | 'fall'): Promise<Anime[]> {
    const activeYear = year ?? new Date().getFullYear()
    const activeSeason = season?.toUpperCase() ?? currentAnimeSeason()
    const data = await this.request<{ Page: { media: AniListMedia[] } }>(
      `query SeasonAnime($year: Int, $season: MediaSeason) {
        Page(page: 1, perPage: 24) {
          media(type: ANIME, isAdult: false, seasonYear: $year, season: $season, sort: [POPULARITY_DESC]) {
            ${MEDIA_FIELDS}
          }
        }
      }`,
      { year: activeYear, season: activeSeason },
    )
    return this.mapMany(data.Page.media)
  }

  async getGenres(): Promise<Genre[]> {
    const data = await this.request<{ GenreCollection: string[] }>(`query Genres { GenreCollection }`)
    return data.GenreCollection.map((name) => ({ id: genreId(name), name }))
  }
}

// -----------------------------------------------------------------------------
// Legacy Jikan provider
// -----------------------------------------------------------------------------
// Kept behind the provider abstraction so a self-hosted Jikan instance can be
// wired back in later without rebuilding the UI. The discontinued public host
// is intentionally NOT used as AnimeFinder's active provider.

type JikanGenre = { mal_id: number; name: string }
type JikanTitle = { type: string; title: string }
type JikanAnime = {
  mal_id: number
  title: string
  title_english?: string | null
  title_japanese?: string | null
  titles?: JikanTitle[]
  images?: { jpg?: { image_url?: string; large_image_url?: string } }
  score?: number | null
  episodes?: number | null
  type?: string | null
  year?: number | null
  status?: string | null
  genres?: JikanGenre[]
  synopsis?: string | null
  url?: string | null
  aired?: { from?: string | null; to?: string | null }
}

export class JikanProvider implements AnimeProvider {
  readonly id = 'jikan'
  readonly name = 'MyAnimeList / Jikan (legacy)'

  constructor(private readonly baseUrl = 'https://api.jikan.moe/v4') {}

  private async request<T>(path: string, retry = true): Promise<T> {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetch(`${this.baseUrl}${path}`, { signal: controller.signal })
      if (response.status === 429 && retry) {
        await wait(900)
        return this.request<T>(path, false)
      }
      if (!response.ok) throw new Error(`Anime provider error (${response.status})`)
      return response.json() as Promise<T>
    } finally {
      window.clearTimeout(timeout)
    }
  }

  private mapAnime(item: JikanAnime): Anime {
    return {
      malId: item.mal_id,
      title: item.title,
      titleEnglish: item.title_english,
      titleJapanese: item.title_japanese,
      titles: item.titles ?? [{ type: 'Default', title: item.title }],
      imageUrl: item.images?.jpg?.image_url,
      largeImageUrl: item.images?.jpg?.large_image_url,
      score: item.score,
      episodes: item.episodes,
      type: item.type,
      year: item.year,
      status: item.status,
      genres: (item.genres ?? []).map((genre) => ({ id: genre.mal_id, name: genre.name })),
      synopsis: item.synopsis,
      url: item.url,
      airedFrom: item.aired?.from,
      airedTo: item.aired?.to,
    }
  }

  async searchAnime(query: string, page = 1): Promise<Anime[]> {
    const payload = await this.request<{ data: JikanAnime[] }>(
      `/anime?q=${encodeURIComponent(query)}&page=${page}&limit=24&sfw=true&order_by=score&sort=desc`,
    )
    return payload.data.map((item) => this.mapAnime(item))
  }

  async getAnime(id: number): Promise<Anime> {
    const payload = await this.request<{ data: JikanAnime }>(`/anime/${id}/full`)
    return this.mapAnime(payload.data)
  }

  async getTopAnime(page = 1): Promise<Anime[]> {
    const payload = await this.request<{ data: JikanAnime[] }>(`/top/anime?page=${page}&limit=24&filter=bypopularity`)
    return payload.data.map((item) => this.mapAnime(item))
  }

  async getSeasonAnime(year?: number, season?: 'winter' | 'spring' | 'summer' | 'fall'): Promise<Anime[]> {
    if (year && season) {
      const payload = await this.request<{ data: JikanAnime[] }>(`/seasons/${year}/${season}?limit=24&sfw=true`)
      return payload.data.map((item) => this.mapAnime(item))
    }
    const payload = await this.request<{ data: JikanAnime[] }>('/seasons/now?limit=24&sfw=true')
    return payload.data.map((item) => this.mapAnime(item))
  }

  async getGenres(): Promise<Genre[]> {
    const payload = await this.request<{ data: JikanGenre[] }>('/genres/anime')
    return payload.data.map((genre) => ({ id: genre.mal_id, name: genre.name }))
  }
}

export const animeProvider: AnimeProvider = new AniListProvider()
