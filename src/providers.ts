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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Shared implementation for APIs that expose the Jikan v4 response schema.
 *
 * Jikan's public instance was discontinued on 2026-10-01. Tenrai v1 is
 * Jikan-schema compatible, so AnimeFinder can preserve MAL IDs, filters,
 * mappings and the existing frontend without coupling UI components to a
 * specific HTTP service.
 */
class JikanCompatibleProvider implements AnimeProvider {
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

      if (response.status === 429 && attempt < 1) {
        const retryAfter = Number(response.headers.get('Retry-After'))
        await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000)
        return this.request<T>(path, attempt + 1)
      }

      if (response.status >= 500 && attempt < 1) {
        await wait(700)
        return this.request<T>(path, attempt + 1)
      }

      if (!response.ok) throw new Error(`Anime provider error (${response.status})`)
      return response.json() as Promise<T>
    } catch (error) {
      if (attempt < 1 && (error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError'))) {
        await wait(700)
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

  async searchAnime(query: string, page = 1): Promise<Anime[]> {
    const payload = await this.request<{ data: JikanAnime[] }>(
      `/anime?q=${encodeURIComponent(query)}&page=${page}&limit=24&sfw=true&order_by=score&sort=desc`,
    )
    return payload.data.map((item) => this.mapAnime(item))
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
    const payload = await this.request<{ data: JikanGenre[] }>('/genres/anime')
    return payload.data.map((genre) => ({ id: genre.mal_id, name: genre.name }))
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
