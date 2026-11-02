import { isSupabaseConfigured, supabase } from './supabase'

export interface AnimeComment {
  malId: number
  contentHtml: string
  contentText: string
  updatedAt?: string | null
  storage: 'supabase'
}

const memory = new Map<number, AnimeComment>()

async function currentUserId() {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new Error('Sign in before using AnimeFinder comments.')
  return data.user.id
}

export async function listAnimeComments(): Promise<AnimeComment[]> {
  const userId = await currentUserId()
  const { data, error } = await supabase!
    .from('anime_comments')
    .select('mal_id,content_html,content_text,updated_at')
    .eq('user_id', userId)
  if (error) throw new Error(`Could not load comments from Supabase: ${error.message}`)
  memory.clear()
  for (const row of data ?? []) {
    const comment: AnimeComment = {
      malId: Number(row.mal_id),
      contentHtml: row.content_html ?? '',
      contentText: row.content_text ?? '',
      updatedAt: row.updated_at ?? null,
      storage: 'supabase',
    }
    memory.set(comment.malId, comment)
  }
  return Array.from(memory.values())
}

export function getCommentFromMemory(malId: number) {
  return memory.get(malId) ?? null
}

export async function saveAnimeComment(malId: number, contentHtml: string, contentText: string): Promise<AnimeComment> {
  const userId = await currentUserId()
  const updatedAt = new Date().toISOString()
  const { error } = await supabase!
    .from('anime_comments')
    .upsert({ user_id: userId, mal_id: malId, content_html: contentHtml, content_text: contentText, updated_at: updatedAt }, { onConflict: 'user_id,mal_id' })
  if (error) throw new Error(`Comment save failed: ${error.message}`)
  const { data, error: readError } = await supabase!
    .from('anime_comments')
    .select('mal_id,content_html,content_text,updated_at')
    .eq('user_id', userId)
    .eq('mal_id', malId)
    .single()
  if (readError || !data) throw new Error(`Comment read-back failed: ${readError?.message ?? 'row missing'}`)
  const saved: AnimeComment = {
    malId: Number(data.mal_id), contentHtml: data.content_html ?? '', contentText: data.content_text ?? '', updatedAt: data.updated_at ?? updatedAt, storage: 'supabase',
  }
  memory.set(malId, saved)
  return saved
}
