import type { Anime } from './types'
import { isSupabaseConfigured, supabase } from './supabase'

export const DEFAULT_WISHLIST_NAME = 'Want to Watch Favorites'

export interface Wishlist {
  id: number
  user_id: string
  name: string
  is_default: boolean
  created_at?: string
  updated_at?: string
}

export interface WishlistItem {
  id: number
  wishlist_id: number
  user_id: string
  mal_id: number
  title: string
  title_english?: string | null
  title_japanese?: string | null
  image_url?: string | null
  score?: number | null
  episodes?: number | null
  type?: string | null
  year?: number | null
  status?: string | null
  created_at?: string
}

async function requireCurrentUser() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured for this deployment.')
  }

  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new Error('You must be signed in to use your AnimeFinder wishlists.')
  return data.user
}

async function createDefaultWishlist(userId: string): Promise<Wishlist> {
  const { data, error } = await supabase!
    .from('wishlists')
    .insert({ user_id: userId, name: DEFAULT_WISHLIST_NAME, is_default: true })
    .select('*')
    .single()

  if (error) {
    const { data: existing, error: lookupError } = await supabase!
      .from('wishlists')
      .select('*')
      .eq('user_id', userId)
      .eq('name', DEFAULT_WISHLIST_NAME)
      .maybeSingle()
    if (lookupError || !existing) throw new Error(error.message)
    return existing as Wishlist
  }

  return data as Wishlist
}

export async function listWishlists(): Promise<Wishlist[]> {
  const user = await requireCurrentUser()
  const { data, error } = await supabase!
    .from('wishlists')
    .select('*')
    .eq('user_id', user.id)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  const lists = (data ?? []) as Wishlist[]
  if (lists.some((list) => list.is_default)) return lists

  const fallback = lists.find((list) => list.name === DEFAULT_WISHLIST_NAME)
  if (fallback) return lists

  const created = await createDefaultWishlist(user.id)
  return [created, ...lists]
}

export async function createWishlist(name: string): Promise<Wishlist> {
  const user = await requireCurrentUser()
  const cleanName = name.trim()
  if (!cleanName) throw new Error('Enter a name for the wishlist.')
  if (cleanName.length > 80) throw new Error('Wishlist names can contain at most 80 characters.')

  const { data: existing, error: lookupError } = await supabase!
    .from('wishlists')
    .select('*')
    .eq('user_id', user.id)
    .eq('name', cleanName)
    .maybeSingle()
  if (lookupError) throw new Error(lookupError.message)
  if (existing) return existing as Wishlist

  const { data, error } = await supabase!
    .from('wishlists')
    .insert({ user_id: user.id, name: cleanName, is_default: false })
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return data as Wishlist
}

export async function listWishlistItems(): Promise<WishlistItem[]> {
  const user = await requireCurrentUser()
  const { data, error } = await supabase!
    .from('wishlist_items')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as WishlistItem[]
}

export async function listAnimeWishlistMembership(malId: number): Promise<WishlistItem[]> {
  const user = await requireCurrentUser()
  const { data, error } = await supabase!
    .from('wishlist_items')
    .select('*')
    .eq('user_id', user.id)
    .eq('mal_id', malId)

  if (error) throw new Error(error.message)
  return (data ?? []) as WishlistItem[]
}

export async function addAnimeToWishlist(wishlistId: number, anime: Anime): Promise<void> {
  const user = await requireCurrentUser()
  const payload = {
    wishlist_id: wishlistId,
    user_id: user.id,
    mal_id: anime.malId,
    title: anime.title,
    title_english: anime.titleEnglish ?? null,
    title_japanese: anime.titleJapanese ?? null,
    image_url: anime.largeImageUrl || anime.imageUrl || null,
    score: anime.score ?? null,
    episodes: anime.episodes ?? null,
    type: anime.type ?? null,
    year: anime.year ?? null,
    status: anime.status ?? null,
  }

  const { error } = await supabase!
    .from('wishlist_items')
    .upsert(payload, { onConflict: 'wishlist_id,mal_id' })

  if (error) throw new Error(error.message)
}

export async function removeAnimeFromWishlist(wishlistId: number, malId: number): Promise<void> {
  const user = await requireCurrentUser()
  const { error } = await supabase!
    .from('wishlist_items')
    .delete()
    .eq('user_id', user.id)
    .eq('wishlist_id', wishlistId)
    .eq('mal_id', malId)

  if (error) throw new Error(error.message)
}
