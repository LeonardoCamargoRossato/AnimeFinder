import type { Anime, WatchedAnime } from './types'
import { isSupabaseConfigured, supabase } from './supabase'

async function requireCurrentUser() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured for this deployment.')
  }

  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new Error('You must be signed in to use your AnimeFinder catalog.')
  return data.user
}

export function watchedFromAnime(anime: Anime, originalTitle = anime.title): WatchedAnime {
  const romaji = anime.titles.find((title) => title.type === 'Default')?.title ?? anime.title
  return {
    mal_id: anime.malId,
    title_original: originalTitle,
    title_english: anime.titleEnglish ?? anime.titles.find((title) => title.type === 'English')?.title ?? null,
    title_romaji: romaji,
    title_japanese: anime.titleJapanese ?? anime.titles.find((title) => title.type === 'Japanese')?.title ?? null,
    title_portuguese: null,
    title_chinese: null,
    match_status: 'manually_confirmed',
  }
}

export async function listWatched(): Promise<WatchedAnime[]> {
  const user = await requireCurrentUser()
  const { data, error } = await supabase!
    .from('watched_anime')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as WatchedAnime[]
}

export async function saveWatched(row: WatchedAnime): Promise<void> {
  const user = await requireCurrentUser()
  const payload = { ...row, user_id: user.id }
  const { error } = await supabase!
    .from('watched_anime')
    .upsert(payload, { onConflict: 'user_id,mal_id' })

  if (error) throw new Error(error.message)
}

export async function saveManyWatched(rows: WatchedAnime[]): Promise<void> {
  const user = await requireCurrentUser()
  if (!rows.length) return

  const payload = rows.map((row) => ({ ...row, user_id: user.id }))
  const { error } = await supabase!
    .from('watched_anime')
    .upsert(payload, { onConflict: 'user_id,mal_id' })

  if (error) throw new Error(error.message)
}

export async function removeWatched(malId: number): Promise<void> {
  const user = await requireCurrentUser()
  const { error } = await supabase!
    .from('watched_anime')
    .delete()
    .eq('user_id', user.id)
    .eq('mal_id', malId)

  if (error) throw new Error(error.message)
}

export function catalogSearch(rows: WatchedAnime[], query: string): WatchedAnime[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return rows

  return rows.filter((row) =>
    [
      row.title_original,
      row.title_portuguese,
      row.title_english,
      row.title_romaji,
      row.title_japanese,
      row.title_chinese,
    ]
      .filter(Boolean)
      .some((title) => title!.toLocaleLowerCase().includes(needle)),
  )
}
