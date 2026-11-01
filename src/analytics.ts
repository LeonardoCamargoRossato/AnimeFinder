import { listWatched } from './catalog'
import { listAnimeComments } from './comments'
import { personalCatalogRepository, personalCatalogWatchedItems } from './personalCatalog'
import type { FranchiseResult, RelatedWork } from './animeDetails'

export type MetricState = 'available' | 'partial' | 'unavailable' | 'loading' | 'error' | 'timeout'

export interface PersonalAnalytics {
  malId: number
  watched: boolean
  rank: number | null
  watchedCatalogSize: number
  percentile: number | null
  originalObservations: string | null
  comments: string | null
  franchiseCompletion: {
    watched: number
    total: number
    percentage: number
  } | null
  similarWatched: RelatedWork[]
}

export interface FranchiseAnalytics {
  average: number | null
  highest: RelatedWork | null
  lowest: RelatedWork | null
  scoreRange: number | null
  standardDeviation: number | null
  scoredWorks: number
  totalWorks: number
  timeline: RelatedWork[]
}

export interface AnalyticsMetric<T = string | number | boolean | string[]> {
  id: string
  label: string
  state: MetricState
  value?: T
  detail?: string
  source?: string
  sourceUrl?: string | null
  retrievedAt?: string
  confidence?: 'high' | 'medium' | 'low'
}

const personalAnalyticsCache = new Map<number, Promise<PersonalAnalytics>>()

function validScoredWorks(franchise: FranchiseResult | null | undefined) {
  return (franchise?.works ?? []).filter((work) => typeof work.malScore === 'number' && Number.isFinite(work.malScore) && work.malScore! > 0 && work.malScore! <= 10)
}

export function calculateFranchiseAnalytics(franchise: FranchiseResult | null | undefined): FranchiseAnalytics {
  const scored = validScoredWorks(franchise)
  const scores = scored.map((work) => work.malScore as number)
  const average = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null
  const highest = scored.length ? [...scored].sort((a, b) => (b.malScore ?? 0) - (a.malScore ?? 0))[0] : null
  const lowest = scored.length ? [...scored].sort((a, b) => (a.malScore ?? 0) - (b.malScore ?? 0))[0] : null
  const scoreRange = highest?.malScore != null && lowest?.malScore != null ? highest.malScore - lowest.malScore : null
  const standardDeviation = scores.length > 1 && average != null
    ? Math.sqrt(scores.reduce((sum, value) => sum + ((value - average) ** 2), 0) / scores.length)
    : null
  const timeline = [...scored].sort((a, b) => {
    const yearA = a.year ?? Number.MAX_SAFE_INTEGER
    const yearB = b.year ?? Number.MAX_SAFE_INTEGER
    return yearA - yearB || a.title.localeCompare(b.title)
  })

  return {
    average: franchise?.average ?? (average == null ? null : Math.round(average * 100) / 100),
    highest,
    lowest,
    scoreRange: scoreRange == null ? null : Math.round(scoreRange * 100) / 100,
    standardDeviation: standardDeviation == null ? null : Math.round(standardDeviation * 100) / 100,
    scoredWorks: scored.length,
    totalWorks: franchise?.works.length ?? 0,
    timeline,
  }
}

export function getPersonalAnalytics(malId: number, franchise?: FranchiseResult | null): Promise<PersonalAnalytics> {
  const cached = personalAnalyticsCache.get(malId)
  if (cached && !franchise) return cached

  const pending = (async () => {
    const item = personalCatalogRepository.findByMalId(malId)
    const personalWatched = personalCatalogWatchedItems()
    const watchedIds = personalCatalogRepository.watchedMalIds()

    const [commentsResult, supabaseWatchedResult] = await Promise.allSettled([
      listAnimeComments(),
      listWatched(),
    ])

    if (supabaseWatchedResult.status === 'fulfilled') {
      supabaseWatchedResult.value.forEach((row) => {
        if (row.mal_id != null) watchedIds.add(row.mal_id)
      })
    }

    const comment = commentsResult.status === 'fulfilled'
      ? commentsResult.value.find((entry) => entry.malId === malId) ?? null
      : null

    const rank = item?.category === 'watched' ? item.myRanked : null
    const catalogSize = personalWatched.length
    const percentile = rank != null && catalogSize > 0
      ? Math.round((rank / catalogSize) * 1000) / 10
      : null

    const franchiseWorks = franchise?.works ?? []
    const similarWatched = franchiseWorks.filter((work) => work.malId !== malId && watchedIds.has(work.malId))
    const completion = franchiseWorks.length
      ? {
          watched: franchiseWorks.filter((work) => watchedIds.has(work.malId)).length,
          total: franchiseWorks.length,
          percentage: Math.round((franchiseWorks.filter((work) => watchedIds.has(work.malId)).length / franchiseWorks.length) * 1000) / 10,
        }
      : null

    return {
      malId,
      watched: watchedIds.has(malId),
      rank,
      watchedCatalogSize: catalogSize,
      percentile,
      originalObservations: item?.originalObservations ?? null,
      comments: comment?.contentText?.trim() || null,
      franchiseCompletion: completion,
      similarWatched,
    }
  })().catch((error) => {
    personalAnalyticsCache.delete(malId)
    throw error
  })

  if (!franchise) personalAnalyticsCache.set(malId, pending)
  return pending
}

export const analyticsService = {
  getPersonalAnalytics,
  calculateFranchiseAnalytics,
}
