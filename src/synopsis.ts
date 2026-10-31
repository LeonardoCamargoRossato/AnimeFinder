import { animeProvider } from './providers'

export interface SynopsisBundle {
  original: string | null
  portuguese: string | null
  source: 'MyAnimeList catalogue' | 'AniList fallback' | null
  translationError?: string
}

type AniListResponse = {
  data?: {
    Media?: {
      description?: string | null
    } | null
  }
  errors?: Array<{ message?: string }>
}

type MyMemoryResponse = {
  responseData?: {
    translatedText?: string
  }
  responseStatus?: number
  responseDetails?: string
}

const synopsisCache = new Map<number, Promise<SynopsisBundle>>()
const encoder = new TextEncoder()

function cleanSynopsis(value?: string | null): string | null {
  if (!value) return null

  const withBreaks = value.replace(/<br\s*\/?\s*>/gi, '\n')
  const container = document.createElement('div')
  container.innerHTML = withBreaks

  const cleaned = (container.textContent || container.innerText || '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()

  if (!cleaned) return null
  if (/no synopsis information has been added/i.test(cleaned)) return null
  if (/no description available/i.test(cleaned)) return null
  return cleaned
}

async function fetchAniListSynopsis(malId: number): Promise<string | null> {
  const query = `
    query ($idMal: Int) {
      Media(idMal: $idMal, type: ANIME) {
        description(asHtml: false)
      }
    }
  `

  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { idMal: malId } }),
  })

  if (!response.ok) return null
  const payload = await response.json() as AniListResponse
  return cleanSynopsis(payload.data?.Media?.description)
}

function splitLongPart(part: string, maxBytes: number): string[] {
  const words = part.split(/\s+/).filter(Boolean)
  const chunks: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (encoder.encode(candidate).length <= maxBytes) {
      current = candidate
      continue
    }

    if (current) chunks.push(current)

    if (encoder.encode(word).length <= maxBytes) {
      current = word
      continue
    }

    let fragment = ''
    for (const character of word) {
      const next = fragment + character
      if (encoder.encode(next).length > maxBytes && fragment) {
        chunks.push(fragment)
        fragment = character
      } else {
        fragment = next
      }
    }
    current = fragment
  }

  if (current) chunks.push(current)
  return chunks
}

function chunkSynopsis(text: string, maxBytes = 430): string[] {
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z0-9“"'])/g).filter(Boolean)
  const chunks: string[] = []
  let current = ''

  for (const part of parts) {
    const candidate = current ? `${current} ${part}` : part
    if (encoder.encode(candidate).length <= maxBytes) {
      current = candidate
      continue
    }

    if (current) chunks.push(current)

    if (encoder.encode(part).length <= maxBytes) {
      current = part
    } else {
      const split = splitLongPart(part, maxBytes)
      chunks.push(...split.slice(0, -1))
      current = split.at(-1) ?? ''
    }
  }

  if (current) chunks.push(current)
  return chunks
}

async function translateChunk(chunk: string): Promise<string> {
  const endpoint = new URL('https://api.mymemory.translated.net/get')
  endpoint.searchParams.set('q', chunk)
  endpoint.searchParams.set('langpair', 'en|pt-BR')
  endpoint.searchParams.set('mt', '1')

  const response = await fetch(endpoint.toString(), {
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) throw new Error(`Translation service error (${response.status})`)
  const payload = await response.json() as MyMemoryResponse
  const translated = payload.responseData?.translatedText?.trim()

  if (!translated || (payload.responseStatus != null && payload.responseStatus >= 400)) {
    throw new Error(payload.responseDetails || 'Automatic translation unavailable')
  }

  return translated
}

async function translateToPortuguese(text: string): Promise<string> {
  const chunks = chunkSynopsis(text)
  const translated: string[] = []

  for (const chunk of chunks) {
    translated.push(await translateChunk(chunk))
  }

  return translated.join(' ')
}

async function buildSynopsisBundle(malId: number): Promise<SynopsisBundle> {
  let original: string | null = null
  let source: SynopsisBundle['source'] = null

  try {
    const anime = await animeProvider.getAnime(malId)
    original = cleanSynopsis(anime.synopsis)
    if (original) source = 'MyAnimeList catalogue'
  } catch {
    // The details page already handles provider errors. Synopsis can still use a fallback source.
  }

  if (!original) {
    try {
      original = await fetchAniListSynopsis(malId)
      if (original) source = 'AniList fallback'
    } catch {
      original = null
    }
  }

  if (!original) {
    return { original: null, portuguese: null, source: null }
  }

  try {
    const portuguese = await translateToPortuguese(original)
    return { original, portuguese, source }
  } catch (error) {
    return {
      original,
      portuguese: null,
      source,
      translationError: error instanceof Error ? error.message : 'Automatic translation unavailable',
    }
  }
}

export function loadSynopsisBundle(malId: number): Promise<SynopsisBundle> {
  const existing = synopsisCache.get(malId)
  if (existing) return existing

  const pending = buildSynopsisBundle(malId).catch((error) => {
    synopsisCache.delete(malId)
    throw error
  })

  synopsisCache.set(malId, pending)
  return pending
}
