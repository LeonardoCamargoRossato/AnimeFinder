import { listWatched } from './catalog'
import { animeProvider } from './providers'
import type { Anime } from './types'
import type { HamletRecommendation, HamletSearchIntent } from './hamletTypes'

const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const unique = <T,>(values: T[]) => Array.from(new Set(values))

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

async function fetchCandidateBatch(genres: string[], pages = 2) {
  const items: Anime[] = []
  for (let page = 1; page <= pages; page += 1) {
    const result = await animeProvider.browseAnime({ page, limit: 25, filters: genres.length ? { genres } : {} })
    items.push(...result.items)
    if (!result.hasNextPage) break
  }
  return items
}

export async function searchHamletAnime(intent: HamletSearchIntent): Promise<HamletRecommendation[]> {
  const [availableGenres, watchedRows] = await Promise.all([animeProvider.getGenres(), listWatched()])
  const canonicalByName = new Map(availableGenres.map((genre) => [normalize(genre.name), genre.name]))
  const canonicalize = (value: string) => canonicalByName.get(normalize(value))
  const desiredGenres = unique([...intent.genres, ...intent.themes].map(canonicalize).filter((value): value is string => Boolean(value)))
  const avoidedGenres = new Set(intent.avoidGenres.map((value) => normalize(canonicalize(value) ?? value)))
  const watchedIds = new Set(watchedRows.map((row) => row.mal_id).filter((id): id is number => id != null))

  let candidates: Anime[] = []
  try {
    if (desiredGenres.length) candidates = await fetchCandidateBatch(desiredGenres, 3)
    if (candidates.length < 8 && desiredGenres.length > 1) candidates.push(...await fetchCandidateBatch(desiredGenres.slice(0, 1), 2))
    if (candidates.length < 8) candidates.push(...await fetchCandidateBatch([], 2))
  } catch (error) {
    if (!candidates.length) throw error
  }

  const byId = new Map<number, Anime>()
  candidates.forEach((anime) => byId.set(anime.malId, anime))
  const queryTerms = normalize(intent.query).split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 3)

  const ranked = Array.from(byId.values()).map((anime) => {
    const genreNames = anime.genres.map((genre) => normalize(genre.name))
    if (genreNames.some((name) => avoidedGenres.has(name))) return null
    if (intent.excludeWatched && watchedIds.has(anime.malId)) return null
    const haystack = normalize([anime.title, anime.titleEnglish, anime.titleJapanese, anime.synopsis, ...anime.genres.map((genre) => genre.name)].filter(Boolean).join(' '))
    if (intent.avoidConcepts.some((concept) => phraseInText(concept, haystack))) return null
    const genreScore = desiredGenres.reduce((score, genre) => score + (genreNames.includes(normalize(genre)) ? 8 : 0), 0)
    const conceptScore = intent.concepts.reduce((score, concept) => score + (phraseInText(concept, haystack) ? 4 : 0), 0)
    const queryScore = queryTerms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0)
    const score = genreScore + conceptScore + queryScore + Math.max(0, anime.score ?? 0) * 0.25
    const why = buildWhy(anime, desiredGenres, intent.concepts)
    return { anime, score, why }
  }).filter((row): row is { anime: Anime; score: number; why: { text: string; matched: string[] } } => Boolean(row))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)

  return ranked.map(({ anime, why }) => ({
    anime,
    whyMatches: why.text,
    matchedCriteria: why.matched,
    watched: watchedIds.has(anime.malId),
  }))
}
