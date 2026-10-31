import type {
  Anime,
  AnimeCharacterCredit,
  AnimeFilterState,
  AnimeRelation,
  AnimeStaffCredit,
  AnimeStreamingLink,
  Genre,
  NamedAnimeEntity,
} from './types'

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
  getAnimeRelations(id: number): Promise<AnimeRelation[]>
  getAnimeStaff(id: number): Promise<AnimeStaffCredit[]>
  getAnimeCharacters(id: number): Promise<AnimeCharacterCredit[]>
  getAnimeStreaming(id: number): Promise<AnimeStreamingLink[]>
  getTopAnime(page?: number): Promise<Anime[]>
  getSeasonAnime(year?: number, season?: 'winter' | 'spring' | 'summer' | 'fall'): Promise<Anime[]>
  getGenres(): Promise<Genre[]>
}

type JikanGenre = { mal_id: number; name: string }
type JikanTitle = { type: string; title: string }
type JikanNamedEntity = { mal_id: number; name: string; url?: string | null }
type JikanImage = { jpg?: { image_url?: string | null; large_image_url?: string | null } }
type JikanAnime = {
  mal_id: number
  title: string
  title_english?: string | null
  title_japanese?: string | null
  titles?: JikanTitle[]
  images?: JikanImage
  score?: number | null
  episodes?: number | null
  type?: string | null
  year?: number | null
  status?: string | null
  genres?: JikanGenre[]
  synopsis?: string | null
  url?: string | null
  aired?: { from?: string | null; to?: string | null }
  source?: string | null
  studios?: JikanNamedEntity[]
  producers?: JikanNamedEntity[]
  licensors?: JikanNamedEntity[]
  rank?: number | null
  popularity?: number | null
  members?: number | null
  favorites?: number | null
  rating?: string | null
  duration?: string | null
  season?: string | null
}

type JikanPagination = {
  last_visible_page?: number
  has_next_page?: boolean
  current_page?: number
  items?: { count?: number; total?: number; per_page?: number }
}

type JikanPagePayload = { data: JikanAnime[]; pagination?: JikanPagination }

type JikanRelationPayload = {
  data: Array<{
    relation: string
    entry: Array<{
      mal_id: number
      type: string
      name: string
      url?: string | null
      media_type?: string | null
      images?: JikanImage
    }>
  }>
}

type JikanStaffPayload = {
  data: Array<{
    person: { mal_id: number; name: string; url?: string | null; images?: JikanImage }
    positions?: string[]
  }>
}

type JikanCharacterPayload = {
  data: Array<{
    character: { mal_id: number; name: string; url?: string | null; images?: JikanImage }
    role?: string | null
    favorites?: number | null
    voice_actors?: Array<{
      person: { mal_id: number; name: string; url?: string | null; images?: JikanImage }
      language: string
    }>
  }>
}

type JikanStreamingPayload = { data: Array<{ name: string; url: string }> }

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function providerType(value?: string) {
  if (!value) return undefined
  const types: Record<string, string> = { TV: 'tv', Movie: 'movie', OVA: 'ova', ONA: 'ona', Special: 'special', Music: 'music' }
  return types[value] ?? value.toLowerCase()
}

function providerStatus(value?: string) {
  if (!value) return undefined
  const statuses: Record<string, string> = { 'Currently Airing': 'airing', 'Finished Airing': 'complete', 'Not yet aired': 'upcoming' }
  return statuses[value] ?? value.toLowerCase()
}

function mapNamedEntity(entity: JikanNamedEntity): NamedAnimeEntity {
  return { id: entity.mal_id, name: entity.name, url: entity.url }
}

class JikanCompatibleProvider implements AnimeProvider {
  private readonly pageCache = new Map<string, Promise<AnimePage>>()
  private readonly animeCache = new Map<number, Promise<Anime>>()
  private readonly relationCache = new Map<number, Promise<AnimeRelation[]>>()
  private readonly staffCache = new Map<number, Promise<AnimeStaffCredit[]>>()
  private readonly characterCache = new Map<number, Promise<AnimeCharacterCredit[]>>()
  private readonly streamingCache = new Map<number, Promise<AnimeStreamingLink[]>>()
  private genreCache: Promise<Genre[]> | null = null

  constructor(readonly id: string, readonly name: string, private readonly baseUrl: string) {}

  private async request<T>(path: string, attempt = 0): Promise<T> {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 10000)
    try {
      const response = await fetch(`${this.baseUrl}${path}`, { signal: controller.signal, headers: { Accept: 'application/json' } })
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
      if (error instanceof DOMException && error.name === 'AbortError') throw new Error('Anime provider timed out. Please try again.')
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
      source: item.source,
      studios: (item.studios ?? []).map(mapNamedEntity),
      producers: (item.producers ?? []).map(mapNamedEntity),
      licensors: (item.licensors ?? []).map(mapNamedEntity),
      rank: item.rank,
      popularity: item.popularity,
      members: item.members,
      favorites: item.favorites,
      rating: item.rating,
      duration: item.duration,
      season: item.season,
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
    params.set('page', String(page)); params.set('limit', String(limit)); params.set('sfw', 'true')
    params.set('order_by', 'score'); params.set('sort', 'desc'); params.set('nulls', 'last')
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
    const pending = this.request<JikanPagePayload>(path).then((payload) => {
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
    }).catch((error) => { this.pageCache.delete(path); throw error })
    this.pageCache.set(path, pending)
    return pending
  }

  async searchAnime(query: string, page = 1): Promise<Anime[]> {
    return (await this.browseAnime({ query, page, limit: 24 })).items
  }

  async getAnime(id: number): Promise<Anime> {
    const cached = this.animeCache.get(id)
    if (cached) return cached
    const pending = this.request<{ data: JikanAnime }>(`/anime/${id}/full?sfw=true`)
      .then((payload) => this.mapAnime(payload.data))
      .catch((error) => { this.animeCache.delete(id); throw error })
    this.animeCache.set(id, pending)
    return pending
  }

  async getAnimeRelations(id: number): Promise<AnimeRelation[]> {
    const cached = this.relationCache.get(id)
    if (cached) return cached
    const pending = this.request<JikanRelationPayload>(`/anime/${id}/relations?sfw=true`)
      .then((payload) => payload.data.map((relation) => ({
        relation: relation.relation,
        entries: relation.entry.map((entry) => ({
          malId: entry.mal_id,
          type: entry.type,
          name: entry.name,
          url: entry.url,
          mediaType: entry.media_type,
          imageUrl: entry.images?.jpg?.image_url,
          largeImageUrl: entry.images?.jpg?.large_image_url,
        })),
      })))
      .catch((error) => { this.relationCache.delete(id); throw error })
    this.relationCache.set(id, pending)
    return pending
  }

  async getAnimeStaff(id: number): Promise<AnimeStaffCredit[]> {
    const cached = this.staffCache.get(id)
    if (cached) return cached
    const pending = this.request<JikanStaffPayload>(`/anime/${id}/staff`)
      .then((payload) => payload.data.map((credit) => ({
        person: {
          malId: credit.person.mal_id,
          name: credit.person.name,
          url: credit.person.url,
          imageUrl: credit.person.images?.jpg?.image_url,
        },
        positions: credit.positions ?? [],
      })))
      .catch((error) => { this.staffCache.delete(id); throw error })
    this.staffCache.set(id, pending)
    return pending
  }

  async getAnimeCharacters(id: number): Promise<AnimeCharacterCredit[]> {
    const cached = this.characterCache.get(id)
    if (cached) return cached
    const pending = this.request<JikanCharacterPayload>(`/anime/${id}/characters`)
      .then((payload) => payload.data.map((credit) => ({
        character: {
          malId: credit.character.mal_id,
          name: credit.character.name,
          url: credit.character.url,
          imageUrl: credit.character.images?.jpg?.image_url,
        },
        role: credit.role,
        favorites: credit.favorites,
        voiceActors: (credit.voice_actors ?? []).map((actor) => ({
          person: {
            malId: actor.person.mal_id,
            name: actor.person.name,
            url: actor.person.url,
            imageUrl: actor.person.images?.jpg?.image_url,
          },
          language: actor.language,
        })),
      })))
      .catch((error) => { this.characterCache.delete(id); throw error })
    this.characterCache.set(id, pending)
    return pending
  }

  async getAnimeStreaming(id: number): Promise<AnimeStreamingLink[]> {
    const cached = this.streamingCache.get(id)
    if (cached) return cached
    const pending = this.request<JikanStreamingPayload>(`/anime/${id}/streaming`)
      .then((payload) => payload.data.map((entry) => ({ name: entry.name, url: entry.url })))
      .catch((error) => { this.streamingCache.delete(id); throw error })
    this.streamingCache.set(id, pending)
    return pending
  }

  async getTopAnime(page = 1): Promise<Anime[]> {
    const payload = await this.request<{ data: JikanAnime[] }>(`/top/anime?page=${page}&limit=24&filter=bypopularity&sfw=true`)
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
    if (!this.genreCache) {
      this.genreCache = this.request<{ data: JikanGenre[] }>('/genres/anime')
        .then((payload) => payload.data.map((genre) => ({ id: genre.mal_id, name: genre.name })))
        .catch((error) => { this.genreCache = null; throw error })
    }
    return this.genreCache
  }
}

export class TenraiProvider extends JikanCompatibleProvider {
  constructor() { super('tenrai', 'MyAnimeList catalogue / Tenrai', 'https://api.tenrai.org/v1') }
}

export class JikanProvider extends JikanCompatibleProvider {
  constructor(baseUrl = 'https://api.jikan.moe/v4') { super('jikan', 'MyAnimeList / Jikan (legacy)', baseUrl) }
}

export const animeProvider: AnimeProvider = new TenraiProvider()
