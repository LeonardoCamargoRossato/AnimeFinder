export interface TranslationService {
  translate(text: string, sourceLanguage: string, targetLanguage: string): Promise<string>
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

class MyMemoryTranslationService implements TranslationService {
  async translate(text: string, sourceLanguage: string, targetLanguage: string) {
    const translated: string[] = []
    for (const chunk of chunkText(text)) {
      const endpoint = new URL('https://api.mymemory.translated.net/get')
      endpoint.searchParams.set('q', chunk)
      endpoint.searchParams.set('langpair', `${sourceLanguage}|${targetLanguage}`)
      endpoint.searchParams.set('mt', '1')
      const response = await fetch(endpoint.toString(), { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`Translation service error (${response.status})`)
      const payload = await response.json() as MyMemoryResponse
      const value = payload.responseData?.translatedText?.trim()
      if (!value || (payload.responseStatus != null && payload.responseStatus >= 400)) {
        throw new Error(payload.responseDetails || 'Automatic translation unavailable')
      }
      translated.push(value)
    }
    return translated.join(' ')
  }
}

export const translationService: TranslationService = new MyMemoryTranslationService()
