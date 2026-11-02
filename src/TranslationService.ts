import { supabase } from './supabase'

export interface TranslationService {
  translate(text: string, sourceLanguage: string, targetLanguage: string): Promise<string>
}

export class TranslationRateLimitError extends Error {
  status = 429
  retryAfterSeconds: number | null
  constructor(message: string, retryAfterSeconds: number | null = null) {
    super(message)
    this.name = 'TranslationRateLimitError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export function isTranslationRateLimitError(error: unknown): error is TranslationRateLimitError {
  return error instanceof TranslationRateLimitError || (error instanceof Error && /\b429\b|rate limit|too many requests/i.test(error.message))
}

type MyMemoryResponse = {
  responseData?: { translatedText?: string }
  responseStatus?: number
  responseDetails?: string
}

const encoder = new TextEncoder()

function splitLongPart(part: string, maxBytes: number): string[] {
  const words = part.split(/\s+/).filter(Boolean)
  const chunks: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (encoder.encode(candidate).length <= maxBytes) { current = candidate; continue }
    if (current) chunks.push(current)
    if (encoder.encode(word).length <= maxBytes) { current = word; continue }
    let fragment = ''
    for (const character of word) {
      const next = fragment + character
      if (encoder.encode(next).length > maxBytes && fragment) { chunks.push(fragment); fragment = character }
      else fragment = next
    }
    current = fragment
  }
  if (current) chunks.push(current)
  return chunks
}

function chunkText(text: string, maxBytes = 430): string[] {
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z0-9“"'])/g).filter(Boolean)
  const chunks: string[] = []
  let current = ''
  for (const part of parts) {
    const candidate = current ? `${current} ${part}` : part
    if (encoder.encode(candidate).length <= maxBytes) { current = candidate; continue }
    if (current) chunks.push(current)
    if (encoder.encode(part).length <= maxBytes) current = part
    else {
      const split = splitLongPart(part, maxBytes)
      chunks.push(...split.slice(0, -1))
      current = split.at(-1) ?? ''
    }
  }
  if (current) chunks.push(current)
  return chunks
}

async function authenticatedContactEmail() {
  try {
    const { data, error } = await supabase?.auth.getUser() ?? { data: { user: null }, error: null }
    if (error) return null
    return data.user?.email?.trim() || null
  } catch {
    return null
  }
}

class MyMemoryTranslationService implements TranslationService {
  async translate(text: string, sourceLanguage: string, targetLanguage: string) {
    const translated: string[] = []
    const contactEmail = await authenticatedContactEmail()
    const chunks = chunkText(text)
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index]
      const endpoint = new URL('https://api.mymemory.translated.net/get')
      endpoint.searchParams.set('q', chunk)
      endpoint.searchParams.set('langpair', `${sourceLanguage}|${targetLanguage}`)
      endpoint.searchParams.set('mt', '1')
      if (contactEmail) endpoint.searchParams.set('de', contactEmail)
      const response = await fetch(endpoint.toString(), { headers: { Accept: 'application/json' } })
      if (response.status === 429) {
        const retryAfterRaw = response.headers.get('Retry-After')
        const retryAfterSeconds = retryAfterRaw && Number.isFinite(Number(retryAfterRaw)) ? Number(retryAfterRaw) : null
        throw new TranslationRateLimitError(
          retryAfterSeconds
            ? `Translation provider rate limit reached (429). Retry after about ${retryAfterSeconds} seconds.`
            : 'Translation provider rate limit reached (429). The PT-BR backfill was stopped before writing additional rows.',
          retryAfterSeconds,
        )
      }
      if (!response.ok) throw new Error(`Translation service error (${response.status})`)
      const payload = await response.json() as MyMemoryResponse
      if (payload.responseStatus === 429) throw new TranslationRateLimitError(payload.responseDetails || 'Translation provider rate limit reached (429).')
      const value = payload.responseData?.translatedText?.trim()
      if (!value || (payload.responseStatus != null && payload.responseStatus >= 400)) {
        throw new Error(payload.responseDetails || 'Automatic translation unavailable')
      }
      translated.push(value)
      if (index < chunks.length - 1) await new Promise((resolve) => window.setTimeout(resolve, 300))
    }
    return translated.join(' ')
  }
}

export const translationService: TranslationService = new MyMemoryTranslationService()
