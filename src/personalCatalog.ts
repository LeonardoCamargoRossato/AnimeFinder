import type { Anime } from './types'
import { animeProvider } from './providers'
import watched1 from './catalog-data/watched-1'
import watched2 from './catalog-data/watched-2'
import watched3 from './catalog-data/watched-3'
import watched4 from './catalog-data/watched-4'
import other from './catalog-data/other'

export type PersonalCatalogCategory =
  | 'watched'
  | 'movies'
  | 'manhua'
  | 'dropped-unfinished'
  | 'new-seasons-2026'
  | 'needs-classification'

interface RawPersonalCatalogItem {
  anime: string
  malUrl: string | null
  malId: number | null
  malScore: number | null
  observations?: string | null
  originalObservations?: string | null
  englishName: string | null
  originalName: string | null
  myRanked: number | null
  category: PersonalCatalogCategory
}

export interface PersonalCatalogItem {
  anime: string
  malUrl: string | null
  malId: number | null
  malScore: number | null
  originalObservations: string | null
  comments: string | null
  englishName: string | null
  originalName: string | null
  myRanked: number | null
  watched: boolean
  category: PersonalCatalogCategory
}

export const personalCatalogCategories: { id: PersonalCatalogCategory; label: string }[] = [
  { id: 'watched', label: 'Watched' },
  { id: 'movies', label: 'Movies' },
  { id: 'manhua', label: 'Manhua' },
  { id: 'dropped-unfinished', label: 'Dropped / Unfinished' },
  { id: 'new-seasons-2026', label: 'New Seasons 2026' },
  { id: 'needs-classification', label: 'Needs Classification' },
]

const rawSnapshot = [
  ...watched1,
  ...watched2,
  ...watched3,
  ...watched4,
  ...other,
] as RawPersonalCatalogItem[]

const snapshot: PersonalCatalogItem[] = rawSnapshot.map((item) => ({
  anime: item.anime,
  malUrl: item.malUrl,
  malId: item.malId,
  malScore: item.malScore,
  originalObservations: item.originalObservations ?? item.observations ?? null,
  comments: null,
  englishName: item.englishName,
  originalName: item.originalName,
  myRanked: item.myRanked,
  watched: item.category === 'watched',
  category: item.category,
}))

const watchedItems = snapshot.filter((item) => item.watched)
const watchedMalIds = new Set(
  watchedItems
    .filter((item) => item.malId != null)
    .map((item) => item.malId as number),
)

const metadataCache = new Map<number, Promise<Anime>>()
const resolvedMetadata = new Map<number, Anime>()
const queue: Array<() => void> = []
let activeRequests = 0
const MAX_CONCURRENT_METADATA_REQUESTS = 3

function pumpQueue() {
  while (activeRequests < MAX_CONCURRENT_METADATA_REQUESTS && queue.length) {
    activeRequests += 1
    const run = queue.shift()!
    run()
  }
}

function scheduleMetadata(malId: number): Promise<Anime> {
  return new Promise((resolve, reject) => {
    queue.push(() => {
      animeProvider.getAnime(malId)
        .then((anime) => {
          resolvedMetadata.set(malId, anime)
          resolve(anime)
        }, reject)
        .finally(() => {
          activeRequests -= 1
          pumpQueue()
        })
    })
    pumpQueue()
  })
}

function normalize(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function isPersonalCatalogWatched(malId: number) {
  return watchedMalIds.has(malId)
}

export function personalCatalogWatchedItems() {
  return watchedItems
}

export const personalCatalogRepository = {
  list(category: PersonalCatalogCategory): PersonalCatalogItem[] {
    return snapshot.filter((item) => item.category === category)
  },

  search(category: PersonalCatalogCategory, query: string): PersonalCatalogItem[] {
    const rows = this.list(category)
    const term = normalize(query.trim())
    if (!term) return rows

    return rows.filter((item) => normalize([
      item.anime,
      item.englishName,
      item.originalName,
      item.originalObservations,
    ].filter(Boolean).join(' ')).includes(term))
  },

  findByMalId(malId: number): PersonalCatalogItem | null {
    return snapshot.find((item) => item.malId === malId) ?? null
  },

  isWatched(malId: number): boolean {
    return isPersonalCatalogWatched(malId)
  },

  watchedCount(): number {
    return watchedItems.length
  },

  watchedMalIds(): Set<number> {
    return new Set(watchedMalIds)
  },

  getCachedMetadata(malId: number): Anime | null {
    return resolvedMetadata.get(malId) ?? null
  },

  getMetadata(malId: number): Promise<Anime> {
    const cachedResolved = resolvedMetadata.get(malId)
    if (cachedResolved) return Promise.resolve(cachedResolved)
    const cached = metadataCache.get(malId)
    if (cached) return cached

    const request = scheduleMetadata(malId).catch((error) => {
      metadataCache.delete(malId)
      throw error
    })
    metadataCache.set(malId, request)
    return request
  },

  count(): number {
    return snapshot.length
  },
}
