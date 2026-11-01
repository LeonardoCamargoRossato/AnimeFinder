import { supabase } from './supabase'
import type { ManagedCatalogWork, PersonalWatchStatus } from './personalCatalogManager'
import type { PersonalCatalogCategory } from './personalCatalog'

interface PersonalCatalogDbRow {
  id: string
  display_name: string
  primary_mal_id: number | null
  category: PersonalCatalogCategory
  watch_status: PersonalWatchStatus
  my_ranked: number | null
  original_observations: string | null
  comments: string | null
  poster_url: string | null
  mal_score: number | string | null
  english_name: string | null
  original_name: string | null
  mal_url: string | null
  association_mal_ids: number[] | null
}

export async function loadRemotePersonalCatalogWorks(): Promise<ManagedCatalogWork[] | null> {
  if (!supabase) return null
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return null
  const { data, error } = await supabase
    .from('personal_catalog_works')
    .select('*')
    .eq('user_id', auth.user.id)
  if (error) return null
  return ((data ?? []) as PersonalCatalogDbRow[]).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    anime: row.display_name,
    primaryMalId: row.primary_mal_id,
    malId: row.primary_mal_id,
    malUrl: row.mal_url,
    malScore: row.mal_score == null ? null : Number(row.mal_score),
    originalObservations: row.original_observations,
    comments: row.comments,
    englishName: row.english_name,
    originalName: row.original_name,
    myRanked: row.my_ranked,
    watched: row.watch_status === 'watched',
    watchStatus: row.watch_status,
    category: row.category,
    associationMalIds: row.association_mal_ids ?? (row.primary_mal_id == null ? [] : [row.primary_mal_id]),
    posterUrl: row.poster_url,
    pending: false,
    source: 'dynamic',
  }))
}
