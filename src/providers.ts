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

export class JikanProvider implements AnimeProvider {
  readonly id = 'jikan'
  readonly name = 'MyAnimeList / Jikan'
  private readonly baseUrl = 'https://api.jikan.moe/v4'

  private async request<T>(path: string, retry = true): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`)
    if (response.status === 429 && retry) {
      await wait(900)
      return this.request<T>(path, false)
    }
    if (!response.ok) throw new Error(`Anime provider error (${response.status})`)
    return response.json() as Promise<T>
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

export const animeProvider: AnimeProvider = new JikanProvider()
