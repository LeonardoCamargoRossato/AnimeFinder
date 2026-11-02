import { listWatched } from './catalog'
import { animeProvider } from './providers'
import type { Anime } from './types'
import type { HamletRecommendation, HamletSearchIntent } from './hamletTypes'

const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const unique = <T,>(values: T[]) => Array.from(new Set(values))
const PAGE_SIZE = 25

export interface HamletSearchMeta {
  catalogTotal: number
  loadedCandidates: number
  filteredRecommendations: number
  pagesLoaded: number
  catalogPages: number
  truncated: boolean
  hasMore: boolean
  nextPage: number | null
}

type HamletSearchSession = {
  key: string
  baseIntent: HamletSearchIntent
  nextPage: number
  catalogTotal: number
  catalogPages: number
  pagesLoaded: number
  items: Map<number, Anime>
}

let lastSearchMeta: HamletSearchMeta = {
  catalogTotal: 0,
  loadedCandidates: 0,
  filteredRecommendations: 0,
  pagesLoaded: 0,
  catalogPages: 0,
  truncated: false,
  hasMore: false,
  nextPage: null,
}

let activeSession: HamletSearchSession | null = null
let continuationRequested = false

export function getLastHamletSearchMeta() {
  return { ...lastSearchMeta }
}

export function requestHamletSearchContinuation() {
  continuationRequested = true
}

function searchIntentKey(intent: HamletSearchIntent) {
  return JSON.stringify({
    genres: [...intent.genres].map(normalize).sort(),
    themes: [...intent.themes].map(normalize).sort(),
    concepts: [...intent.concepts].map(normalize).sort(),
    avoidGenres: [...intent.avoidGenres].map(normalize).sort(),
    avoidConcepts: [...intent.avoidConcepts].map(normalize).sort(),
    excludeWatched: intent.excludeWatched,
  })
}

function phraseInText(phrase: string, text: string) {
  const words = normalize(phrase).split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2)
  if (!words.length) return false
  return words.every((word) => text.includes(word))
}

function buildWhy(anime: Anime, desiredGenres: string[], concepts: string[]) {
  const animeGenres = new Set(anime.genres.map((genre) => normalize(genre.name)))
  const matchedGenres = desiredGenres.filter((genre) => animeGenres.has(normalize(genre)))
  const haystack = normalize([anime.title, anime.titleEnglish, anime.synopsis, ...anime.genres.map((genre) => genre.name)].filter(Boolean).join(' '))
  const matchedConcepts = concepts.filter((concept) => phraseInText(concept, haystack))
  const matched = unique([...matchedGenres, ...matchedConcepts]).slice(0, 5)
  if (matchedGenres.length && matchedConcepts.length) return { text: `Strong match for ${matchedGenres.slice(0, 2).join(' + ')}, with metadata also matching ${matchedConcepts.slice(0, 2).join(' and ')}.`, matched }
  if (matchedGenres.length) return { text: `Matches the requested ${matchedGenres.slice(0, 3).join(', ')} criteria in the provider metadata.`, matched }
  if (matchedConcepts.length) return { text: `Its available title/synopsis metadata matches ${matchedConcepts.slice(0, 3).join(', ')}.`, matched }
  return { text: anime.score != null ? `A high-scoring catalog result compatible with the current broad criteria (MAL score ${anime.score.toFixed(1)}).` : 'A catalog result compatible with the current broad criteria.', matched }
}

async function fetchCandidatePage(genres: string[], page: number) {
  const filters = genres.length ? { genres } : {}
  const result = await animeProvider.browseAnime({ page, limit: PAGE_SIZE, filters })
  const catalogTotal = result.total ?? result.items.length
  const catalogPages = result.lastPage ?? Math.max(1, Math.ceil(catalogTotal / PAGE_SIZE))
  return {
    items: result.items,
    catalogTotal,
    catalogPages,
    hasNextPage: result.hasNextPage,
  }
}

export async function searchHamletAnime(intent: HamletSearchIntent): Promise<HamletRecommendation[]> {
  const [availableGenres, watchedRows] = await Promise.all([animeProvider.getGenres(), listWatched()])
  const canonicalByName = new Map(availableGenres.map((genre) => [normalize(genre.name), genre.name]))
  const canonicalize = (value: string) => canonicalByName.get(normalize(value))
  const desiredGenres = unique([...intent.genres, ...intent.themes].map(canonicalize).filter((value): value is string => Boolean(value)))
  const key = searchIntentKey(intent)
  const continueExisting = continuationRequested && activeSession?.key === key
  continuationRequested = false

  if (!activeSession || activeSession.key !== key || !continueExisting) {
    activeSession = {
      key,
      baseIntent: intent,
      nextPage: 1,
      catalogTotal: 0,
      catalogPages: 0,
      pagesLoaded: 0,
      items: new Map<number, Anime>(),
    }
  }

  const session = activeSession
  const pageToLoad = Math.max(1, session.nextPage)
  const page = await fetchCandidatePage(desiredGenres, pageToLoad)
  page.items.forEach((anime) => session.items.set(anime.malId, anime))
  session.catalogTotal = page.catalogTotal
  session.catalogPages = page.catalogPages
  session.pagesLoaded = Math.max(session.pagesLoaded, pageToLoad)
  session.nextPage = page.hasNextPage && pageToLoad < page.catalogPages ? pageToLoad + 1 : page.catalogPages + 1

  const rankingIntent = session.baseIntent
  const avoidedGenres = new Set(rankingIntent.avoidGenres.map((value) => normalize(canonicalize(value) ?? value)))
  const watchedIds = new Set(watchedRows.map((row) => row.mal_id).filter((id): id is number => id != null))
  const queryTerms = normalize(rankingIntent.query).split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 3)

  const ranked = Array.from(session.items.values()).map((anime) => {
    const genreNames = anime.genres.map((genre) => normalize(genre.name))
    if (genreNames.some((name) => avoidedGenres.has(name))) return null
    if (rankingIntent.excludeWatched && watchedIds.has(anime.malId)) return null
    const haystack = normalize([anime.title, anime.titleEnglish, anime.titleJapanese, anime.synopsis, ...anime.genres.map((genre) => genre.name)].filter(Boolean).join(' '))
    if (rankingIntent.avoidConcepts.some((concept) => phraseInText(concept, haystack))) return null
    const genreScore = desiredGenres.reduce((score, genre) => score + (genreNames.includes(normalize(genre)) ? 8 : 0), 0)
    const conceptScore = rankingIntent.concepts.reduce((score, concept) => score + (phraseInText(concept, haystack) ? 4 : 0), 0)
    const queryScore = queryTerms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0)
    const score = genreScore + conceptScore + queryScore + Math.max(0, anime.score ?? 0) * 0.25
    const why = buildWhy(anime, desiredGenres, rankingIntent.concepts)
    return { anime, score, why }
  }).filter((row): row is { anime: Anime; score: number; why: { text: string; matched: string[] } } => Boolean(row))
    .sort((a, b) => b.score - a.score)

  const recommendations = ranked.map(({ anime, why }) => ({
    anime,
    whyMatches: why.text,
    matchedCriteria: why.matched,
    watched: watchedIds.has(anime.malId),
  }))

  const hasMore = session.nextPage <= session.catalogPages
  lastSearchMeta = {
    catalogTotal: session.catalogTotal,
    loadedCandidates: session.items.size,
    filteredRecommendations: recommendations.length,
    pagesLoaded: session.pagesLoaded,
    catalogPages: session.catalogPages,
    truncated: hasMore,
    hasMore,
    nextPage: hasMore ? session.nextPage : null,
  }

  return recommendations
}
