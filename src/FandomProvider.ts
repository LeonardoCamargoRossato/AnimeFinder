export interface FandomCharacterResult {
  provider: 'fandom'
  externalId: string
  canonicalName: string
  url: string
  wikiDomain: string
  imageUrl?: string | null
  description?: string | null
}

export class FandomProviderUnavailableError extends Error {
  readonly code = 'FANDOM_PROVIDER_UNAVAILABLE'
  constructor(message = 'Fandom is temporarily unavailable.') {
    super(message)
    this.name = 'FandomProviderUnavailableError'
  }
}

type MediaWikiPage = {
  pageid: number
  title: string
  extract?: string
  thumbnail?: { source?: string }
}

type MediaWikiSearchResponse = {
  query?: { pages?: Record<string, MediaWikiPage> }
  error?: { code?: string; info?: string }
}

const KNOWN_WIKIS: Record<string, string> = {
  'world trigger': 'worldtrigger.fandom.com',
}

function normalize(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function slug(value: string) {
  return normalize(value).replace(/\s+/g, '')
}

function wikiCandidates(workName: string) {
  const key = normalize(workName)
  const rows = [KNOWN_WIKIS[key], `${slug(workName)}.fandom.com`].filter((value): value is string => Boolean(value))
  return Array.from(new Set(rows))
}

function pageUrl(domain: string, title: string) {
  return `https://${domain}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
}

async function fetchWiki(domain: string, query: string, attempt = 0): Promise<FandomCharacterResult[]> {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '0',
    gsrlimit: '8',
    prop: 'pageimages|extracts',
    piprop: 'thumbnail',
    pithumbsize: '320',
    exintro: '1',
    explaintext: '1',
    exsentences: '3',
    redirects: '1',
    format: 'json',
    origin: '*',
  })
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 6500)
  try {
    const response = await fetch(`https://${domain}/api.php?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if ((response.status === 429 || response.status >= 500) && attempt < 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 700))
      return fetchWiki(domain, query, attempt + 1)
    }
    if (!response.ok) throw new Error(`Fandom ${domain} returned HTTP ${response.status}`)
    const payload = await response.json() as MediaWikiSearchResponse
    if (payload.error) throw new Error(payload.error.info ?? payload.error.code ?? 'Fandom API error')
    return Object.values(payload.query?.pages ?? {})
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((page) => ({
        provider: 'fandom' as const,
        externalId: String(page.pageid),
        canonicalName: page.title,
        url: pageUrl(domain, page.title),
        wikiDomain: domain,
        imageUrl: page.thumbnail?.source ?? null,
        description: page.extract?.trim() ?? null,
      }))
  } catch (error) {
    const transient = error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError')
    if (transient && attempt < 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 650))
      return fetchWiki(domain, query, attempt + 1)
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function searchFandomCharacter(workName: string, query: string): Promise<FandomCharacterResult[]> {
  const term = query.trim()
  if (!term) return []
  const errors: string[] = []
  for (const domain of wikiCandidates(workName)) {
    try {
      const results = await fetchWiki(domain, term)
      if (results.length) return results
    } catch (error) {
      errors.push(`${domain}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (errors.length) throw new FandomProviderUnavailableError(`Fandom is temporarily unavailable. ${errors.join(' · ')}`)
  return []
}
