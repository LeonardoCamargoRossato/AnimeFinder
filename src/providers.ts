import type { Anime, AnimeFilterState, Genre } from './types'

export interface AnimeCatalogRequest {
  query?: string
  page?: number
  limit?: number
  filters?: AnimeFilterState
}

export interface AnimePage {
  items: Anime[]
  page: number
  perPage: number
  hasNextPage: boolean
  total?: number
  lastPage?: number
}

export interface AnimeProvider {
  readonly id: string
  readonly name: string
  browseAnime(request?: AnimeCatalogRequest): Promise<AnimePage>
  searchAnime(query: string, page?: number): Promise<Anime[]>
  getAnime(id: number): Promise<Anime>
  getTopAnime(page?: number): Promise<Anime[]>
  getSeasonAnime(year?: number, season?: 'winter' | 'spring' | 'summer' | 'fall'): Promise<Anime[]>
  getGenres(): Promise<Genre[]>
}

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

type JikanPagination = {
  last_visible_page?: number
  has_next_page?: boolean
  current_page?: number
  items?: {
    count?: number
    total?: number
    per_page?: number
  }
}

type JikanPagePayload = {
  data: JikanAnime[]
  pagination?: JikanPagination
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function providerType(value?: string) {
  if (!value) return undefined
  const types: Record<string, string> = {
    TV: 'tv',
    Movie: 'movie',
    OVA: 'ova',
    ONA: 'ona',
    Special: 'special',
    Music: 'music',
  }
  return types[value] ?? value.toLowerCase()
}

function providerStatus(value?: string) {
  if (!value) return undefined
  const statuses: Record<string, string> = {
    'Currently Airing': 'airing',
    'Finished Airing': 'complete',
    'Not yet aired': 'upcoming',
  }
  return statuses[value] ?? value.toLowerCase()
}

/**
 * Shared implementation for APIs that expose the Jikan v4 response schema.
 *
 * Tenrai v1 exposes the full public MAL catalogue with Jikan-compatible
 * responses. All catalogue paging/filter logic lives here so the Discover UI
 * remains provider-agnostic.
 */
class JikanCompatibleProvider implements AnimeProvider {
  private readonly pageCache = new Map<string, Promise<AnimePage>>()
  private genreCache: Promise<Genre[]> | null = null

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly baseUrl: string,
  ) {}

  private async request<T>(path: string, attempt = 0): Promise<T> {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 10000)

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })

      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get('Retry-After'))
        await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * (attempt + 1))
        return this.request<T>(path, attempt + 1)
      }

      if (response.status >= 500 && attempt < 1) {
        await wait(800)
        return this.request<T>(path, attempt + 1)
      }

      if (!response.ok) throw new Error(`Anime provider error (${response.status})`)
      return response.json() as Promise<T>
    } catch (error) {
      if (attempt < 1 && (error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError'))) {
        await wait(800)
        return this.request<T>(path, attempt + 1)
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('Anime provider timed out. Please try again.')
      }
      throw error
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
      url: item.url ?? `https://myanimelist.net/anime/${item.mal_id}`,
      airedFrom: item.aired?.from,
      airedTo: item.aired?.to,
    }
  }

  private async resolveGenreIds(names: string[] | undefined) {
    if (!names?.length) return []
    const genres = await this.getGenres()
    const byName = new Map(genres.map((genre) => [genre.name.toLowerCase(), genre.id]))
    return names.map((name) => byName.get(name.toLowerCase())).filter((id): id is number => id != null)
  }

  async browseAnime(request: AnimeCatalogRequest = {}): Promise<AnimePage> {
    const page = Math.max(1, request.page ?? 1)
    const limit = Math.min(25, Math.max(1, request.limit ?? 12))
    const filters = request.filters ?? {}
    const genreIds = await this.resolveGenreIds(filters.genres)

    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', String(limit))
    params.set('sfw', 'true')
    params.set('order_by', 'score')
    params.set('sort', 'desc')
    params.set('nulls', 'last')

    const query = request.query?.trim()
    if (query) params.set('q', query)
    if (filters.score_min != null) params.set('min_score', String(filters.score_min))
    if (filters.score_max != null) params.set('max_score', String(filters.score_max))
    if (filters.episodes_min != null) params.set('min_episodes', String(filters.episodes_min))
    if (filters.episodes_max != null) params.set('max_episodes', String(filters.episodes_max))
    if (filters.year != null) params.set('year', String(filters.year))
    if (filters.type) params.set('type', providerType(filters.type)!)
    if (filters.status) params.set('status', providerStatus(filters.status)!)
    if (genreIds.length) params.set('genres', genreIds.join(','))

    const path = `/anime?${params.toString()}`
    const cached = this.pageCache.get(path)
    if (cached) return cached

    const requestPromise = this.request<JikanPagePayload>(path)
      .then((payload) => {
        const pagination = payload.pagination
        const perPage = pagination?.items?.per_page ?? limit
        return {
          items: payload.data.map((item) => this.mapAnime(item)),
          page: pagination?.current_page ?? page,
          perPage,
          hasNextPage: pagination?.has_next_page ?? payload.data.length >= perPage,
          total: pagination?.items?.total,
          lastPage: pagination?.last_visible_page,
        }
      })
      .catch((error) => {
        this.pageCache.delete(path)
        throw error
      })

    this.pageCache.set(path, requestPromise)
    return requestPromise
  }

  async searchAnime(query: string, page = 1): Promise<Anime[]> {
    return (await this.browseAnime({ query, page, limit: 24 })).items
  }

  async getAnime(id: number): Promise<Anime> {
    const payload = await this.request<{ data: JikanAnime }>(`/anime/${id}/full?sfw=true`)
    return this.mapAnime(payload.data)
  }

  async getTopAnime(page = 1): Promise<Anime[]> {
    const payload = await this.request<{ data: JikanAnime[] }>(
      `/top/anime?page=${page}&limit=24&filter=bypopularity&sfw=true`,
    )
    return payload.data.map((item) => this.mapAnime(item))
  }

  async getSeasonAnime(year?: number, season?: 'winter' | 'spring' | 'summer' | 'fall'): Promise<Anime[]> {
    if (year && season) {
      const payload = await this.request<{ data: JikanAnime[] }>(
        `/seasons/${year}/${season}?limit=24&sfw=true`,
      )
      return payload.data.map((item) => this.mapAnime(item))
    }

    const payload = await this.request<{ data: JikanAnime[] }>('/seasons/now?limit=24&sfw=true')
    return payload.data.map((item) => this.mapAnime(item))
  }

  async getGenres(): Promise<Genre[]> {
    if (!this.genreCache) {
      this.genreCache = this.request<{ data: JikanGenre[] }>('/genres/anime')
        .then((payload) => payload.data.map((genre) => ({ id: genre.mal_id, name: genre.name })))
        .catch((error) => {
          this.genreCache = null
          throw error
        })
    }
    return this.genreCache
  }
}

export class TenraiProvider extends JikanCompatibleProvider {
  constructor() {
    super('tenrai', 'MyAnimeList catalogue / Tenrai', 'https://api.tenrai.org/v1')
  }
}

/**
 * Kept for a future self-hosted Jikan deployment. The discontinued public
 * api.jikan.moe host is not used by the active AnimeFinder provider.
 */
export class JikanProvider extends JikanCompatibleProvider {
  constructor(baseUrl = 'https://api.jikan.moe/v4') {
    super('jikan', 'MyAnimeList / Jikan (legacy)', baseUrl)
  }
}

export const animeProvider: AnimeProvider = new TenraiProvider()
