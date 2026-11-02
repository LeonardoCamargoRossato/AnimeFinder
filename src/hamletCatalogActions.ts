import type { Anime } from './types'
import type { PersonalCatalogCategory } from './personalCatalog'
import { createManagedWorkFromAnime, findManagedWorkByMalId, hydrateManagedCatalog, isManagedCatalogHydrated, listManagedCatalogWorks, listManagedCategory, saveManagedCatalog, upsertDynamicWork, type ManagedCatalogWork } from './personalCatalogManager'

export type HamletCatalogAction = 'watched' | 'needs_classification'

export async function applyHamletCatalogAction(anime: Anime, action: HamletCatalogAction) {
  if (!isManagedCatalogHydrated()) await hydrateManagedCatalog()
  const works = listManagedCatalogWorks()
  const existing = findManagedWorkByMalId(anime.malId, works)
  const category: PersonalCatalogCategory = action === 'watched' ? 'watched' : 'needs-classification'
  const watchedRank = action === 'watched'
    ? (existing?.myRanked ?? (listManagedCategory('watched', works).reduce((max, row) => Math.max(max, row.myRanked ?? 0), 0) + 1))
    : null

  if (existing) {
    const updated: ManagedCatalogWork = {
      ...existing,
      category,
      watched: action === 'watched',
      watchStatus: action === 'watched' ? 'watched' : 'unknown',
      myRanked: watchedRank,
      posterUrl: existing.posterUrl ?? anime.imageUrl ?? anime.largeImageUrl ?? null,
      malScore: existing.malScore ?? anime.score ?? null,
      genres: existing.genres?.length ? existing.genres : anime.genres.map((genre) => genre.name),
    }
    await saveManagedCatalog(works.map((row) => row.id === existing.id ? updated : row))
    return updated
  }

  const created = createManagedWorkFromAnime(anime, anime.title, category, watchedRank)
  await saveManagedCatalog(upsertDynamicWork(works, created))
  return created
}
