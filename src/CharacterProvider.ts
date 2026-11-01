export type CharacterProviderId = 'jikan'

export interface CharacterVoiceActor {
  malId: number
  name: string
  language: string
  imageUrl?: string | null
  url?: string | null
}

export interface ExternalCharacterSummary {
  provider: CharacterProviderId
  providerCharacterId: number
  canonicalName: string
  imageUrl?: string | null
  role?: string | null
  url?: string | null
  favorites?: number | null
  voiceActors?: CharacterVoiceActor[]
}

export interface CharacterAppearance {
  malId: number
  title: string
  role?: string | null
  type: 'anime' | 'manga'
  imageUrl?: string | null
  url?: string | null
}

export interface ExternalCharacterFull extends ExternalCharacterSummary {
  alternativeNames: string[]
  about?: string | null
  animeAppearances: CharacterAppearance[]
  mangaAppearances: CharacterAppearance[]
  voiceActors: CharacterVoiceActor[]
  fetchedAt: string
}

export interface CharacterProvider {
  readonly id: CharacterProviderId
  getAnimeCharacters(animeMalId: number): Promise<ExternalCharacterSummary[]>
  getCharacter(characterMalId: number): Promise<ExternalCharacterFull>
  searchCharacter(query: string): Promise<ExternalCharacterSummary[]>
}

type JikanImage = { jpg?: { image_url?: string | null; large_image_url?: string | null } }
type JikanCharacterListPayload = {
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
type JikanCharacterFullPayload = {
  data: {
    mal_id: number
    name: string
    name_kanji?: string | null
    nicknames?: string[]
    about?: string | null
    url?: string | null
    images?: JikanImage
    favorites?: number | null
    anime?: Array<{ role?: string | null; anime: { mal_id: number; title: string; url?: string | null; images?: JikanImage } }>
    manga?: Array<{ role?: string | null; manga: { mal_id: number; title: string; url?: string | null; images?: JikanImage } }>
    voices?: Array<{ language: string; person: { mal_id: number; name: string; url?: string | null; images?: JikanImage } }>
  }
}
type JikanCharacterSearchPayload = {
  data: Array<{
    mal_id: number
    name: string
    url?: string | null
    images?: JikanImage
    favorites?: number | null
  }>
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class JikanCharacterProvider implements CharacterProvider {
  readonly id = 'jikan' as const
  private animeCache = new Map<number, Promise<ExternalCharacterSummary[]>>()
  private characterCache = new Map<number, Promise<ExternalCharacterFull>>()
  private searchCache = new Map<string, Promise<ExternalCharacterSummary[]>>()

  constructor(private readonly baseUrl = 'https://api.jikan.moe/v4') {}

  private async request<T>(path: string, attempt = 0): Promise<T> {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 9000)
    try {
      const response = await fetch(`${this.baseUrl}${path}`, { signal: controller.signal, headers: { Accept: 'application/json' } })
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get('Retry-After'))
        await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 900 * (attempt + 1))
        return this.request<T>(path, attempt + 1)
      }
      if (response.status >= 500 && attempt < 1) {
        await wait(700)
        return this.request<T>(path, attempt + 1)
      }
      if (!response.ok) throw new Error(`Jikan character provider error (${response.status})`)
      return response.json() as Promise<T>
    } catch (error) {
      if (attempt < 1 && (error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError'))) {
        await wait(700)
        return this.request<T>(path, attempt + 1)
      }
      if (error instanceof DOMException && error.name === 'AbortError') throw new Error('Jikan character request timed out.')
      throw error
    } finally {
      window.clearTimeout(timeout)
    }
  }

  getAnimeCharacters(animeMalId: number) {
    const cached = this.animeCache.get(animeMalId)
    if (cached) return cached
    const pending = this.request<JikanCharacterListPayload>(`/anime/${animeMalId}/characters`)
      .then((payload) => payload.data.map((entry) => ({
        provider: 'jikan' as const,
        providerCharacterId: entry.character.mal_id,
        canonicalName: entry.character.name,
        imageUrl: entry.character.images?.jpg?.image_url ?? entry.character.images?.jpg?.large_image_url ?? null,
        role: entry.role ?? null,
        url: entry.character.url ?? `https://myanimelist.net/character/${entry.character.mal_id}`,
        favorites: entry.favorites ?? null,
        voiceActors: (entry.voice_actors ?? []).map((actor) => ({
          malId: actor.person.mal_id,
          name: actor.person.name,
          language: actor.language,
          imageUrl: actor.person.images?.jpg?.image_url ?? null,
          url: actor.person.url ?? null,
        })),
      })))
      .catch((error) => { this.animeCache.delete(animeMalId); throw error })
    this.animeCache.set(animeMalId, pending)
    return pending
  }

  getCharacter(characterMalId: number) {
    const cached = this.characterCache.get(characterMalId)
    if (cached) return cached
    const pending = this.request<JikanCharacterFullPayload>(`/characters/${characterMalId}/full`)
      .then(({ data }) => ({
        provider: 'jikan' as const,
        providerCharacterId: data.mal_id,
        canonicalName: data.name,
        imageUrl: data.images?.jpg?.image_url ?? data.images?.jpg?.large_image_url ?? null,
        url: data.url ?? `https://myanimelist.net/character/${data.mal_id}`,
        favorites: data.favorites ?? null,
        alternativeNames: [data.name_kanji, ...(data.nicknames ?? [])].filter((value): value is string => Boolean(value?.trim())),
        about: data.about ?? null,
        animeAppearances: (data.anime ?? []).map((row) => ({
          malId: row.anime.mal_id,
          title: row.anime.title,
          role: row.role ?? null,
          type: 'anime' as const,
          imageUrl: row.anime.images?.jpg?.image_url ?? null,
          url: row.anime.url ?? null,
        })),
        mangaAppearances: (data.manga ?? []).map((row) => ({
          malId: row.manga.mal_id,
          title: row.manga.title,
          role: row.role ?? null,
          type: 'manga' as const,
          imageUrl: row.manga.images?.jpg?.image_url ?? null,
          url: row.manga.url ?? null,
        })),
        voiceActors: (data.voices ?? []).map((actor) => ({
          malId: actor.person.mal_id,
          name: actor.person.name,
          language: actor.language,
          imageUrl: actor.person.images?.jpg?.image_url ?? null,
          url: actor.person.url ?? null,
        })),
        fetchedAt: new Date().toISOString(),
      }))
      .catch((error) => { this.characterCache.delete(characterMalId); throw error })
    this.characterCache.set(characterMalId, pending)
    return pending
  }

  searchCharacter(query: string) {
    const term = query.trim()
    if (!term) return Promise.resolve([])
    const key = term.toLocaleLowerCase()
    const cached = this.searchCache.get(key)
    if (cached) return cached
    const pending = this.request<JikanCharacterSearchPayload>(`/characters?q=${encodeURIComponent(term)}&limit=12&order_by=favorites&sort=desc`)
      .then((payload) => payload.data.map((row) => ({
        provider: 'jikan' as const,
        providerCharacterId: row.mal_id,
        canonicalName: row.name,
        imageUrl: row.images?.jpg?.image_url ?? row.images?.jpg?.large_image_url ?? null,
        url: row.url ?? `https://myanimelist.net/character/${row.mal_id}`,
        favorites: row.favorites ?? null,
      })))
      .catch((error) => { this.searchCache.delete(key); throw error })
    this.searchCache.set(key, pending)
    return pending
  }
}

export const characterProvider: CharacterProvider = new JikanCharacterProvider()
