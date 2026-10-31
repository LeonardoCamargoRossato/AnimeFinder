import type { Anime, WatchedAnime } from './types'
import { isSupabaseConfigured, supabase } from './supabase'

const STORAGE_KEY = 'animefinder.watched'

function readLocal(): WatchedAnime[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as WatchedAnime[]
  } catch {
    return []
  }
}

function writeLocal(rows: WatchedAnime[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
}

async function currentUserId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
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
  const userId = await currentUserId()
  if (isSupabaseConfigured && supabase && userId) {
    const { data, error } = await supabase
      .from('watched_anime')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
    if (!error && data) return data as WatchedAnime[]
  }
  return readLocal()
}

export async function saveWatched(row: WatchedAnime): Promise<void> {
  const now = new Date().toISOString()
  const userId = await currentUserId()
  if (isSupabaseConfigured && supabase && userId) {
    const payload = { ...row, user_id: userId, updated_at: now }
    const { error } = await supabase.from('watched_anime').upsert(payload, { onConflict: 'user_id,mal_id' })
    if (!error) return
    console.warn('Supabase save failed; using local catalog instead.', error.message)
  }

  const rows = readLocal()
  const existingIndex = row.mal_id == null ? -1 : rows.findIndex((item) => item.mal_id === row.mal_id)
  const record: WatchedAnime = {
    ...row,
    id: existingIndex >= 0 ? rows[existingIndex].id : crypto.randomUUID(),
    created_at: existingIndex >= 0 ? rows[existingIndex].created_at : now,
    updated_at: now,
  }
  if (existingIndex >= 0) rows[existingIndex] = record
  else rows.unshift(record)
  writeLocal(rows)
}

export async function saveManyWatched(rows: WatchedAnime[]): Promise<void> {
  for (const row of rows) await saveWatched(row)
}

export async function removeWatched(malId: number): Promise<void> {
  const userId = await currentUserId()
  if (isSupabaseConfigured && supabase && userId) {
    const { error } = await supabase
      .from('watched_anime')
      .delete()
      .eq('user_id', userId)
      .eq('mal_id', malId)
    if (!error) return
  }
  writeLocal(readLocal().filter((item) => item.mal_id !== malId))
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

export async function getCatalogMode(): Promise<'supabase' | 'local'> {
  const userId = await currentUserId()
  return isSupabaseConfigured && userId ? 'supabase' : 'local'
}
