import { isSupabaseConfigured, supabase } from './supabase'

export interface AnimeComment {
  malId: number
  contentHtml: string
  contentText: string
  updatedAt?: string | null
  storage: 'supabase' | 'local'
}

const LOCAL_KEY = 'animefinder.personalComments.v1'

function readLocal(): Record<string, Omit<AnimeComment, 'malId' | 'storage'>> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as Record<string, Omit<AnimeComment, 'malId' | 'storage'>>
  } catch {
    return {}
  }
}

function writeLocal(rows: Record<string, Omit<AnimeComment, 'malId' | 'storage'>>) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(rows))
}

function localComments(): AnimeComment[] {
  const rows: AnimeComment[] = Object.entries(readLocal()).map(([malId, value]) => ({
    malId: Number(malId),
    contentHtml: value.contentHtml ?? '',
    contentText: value.contentText ?? '',
    updatedAt: value.updatedAt ?? null,
    storage: 'local' as const,
  }))
  return rows.filter((row) => Number.isFinite(row.malId))
}

function saveLocal(comment: Omit<AnimeComment, 'storage'>): AnimeComment {
  const rows = readLocal()
  rows[String(comment.malId)] = {
    contentHtml: comment.contentHtml,
    contentText: comment.contentText,
    updatedAt: comment.updatedAt ?? new Date().toISOString(),
  }
  writeLocal(rows)
  return { ...comment, storage: 'local' }
}

async function currentUserId() {
  if (!isSupabaseConfigured || !supabase) return null
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  return data.user.id
}

function isMissingCommentsTable(error: { code?: string; message?: string } | null) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase()
  return text.includes('42p01') || text.includes('pgrst205') || text.includes('anime_comments')
}

export async function listAnimeComments(): Promise<AnimeComment[]> {
  const local = localComments()
  const userId = await currentUserId()
  if (!userId || !supabase) return local

  const { data, error } = await supabase
    .from('anime_comments')
    .select('mal_id,content_html,content_text,updated_at')
    .eq('user_id', userId)

  if (error) {
    if (!isMissingCommentsTable(error)) console.warn('AnimeFinder comments: Supabase read failed, using local fallback.', error.message)
    return local
  }

  const merged = new Map<number, AnimeComment>()
  local.forEach((row) => merged.set(row.malId, row))
  ;(data ?? []).forEach((row) => {
    merged.set(Number(row.mal_id), {
      malId: Number(row.mal_id),
      contentHtml: row.content_html ?? '',
      contentText: row.content_text ?? '',
      updatedAt: row.updated_at ?? null,
      storage: 'supabase',
    })
  })
  return Array.from(merged.values())
}

export async function saveAnimeComment(malId: number, contentHtml: string, contentText: string): Promise<AnimeComment> {
  const updatedAt = new Date().toISOString()
  const localSaved = saveLocal({ malId, contentHtml, contentText, updatedAt })
  const userId = await currentUserId()
  if (!userId || !supabase) return localSaved

  const { error } = await supabase
    .from('anime_comments')
    .upsert({
      user_id: userId,
      mal_id: malId,
      content_html: contentHtml,
      content_text: contentText,
      updated_at: updatedAt,
    }, { onConflict: 'user_id,mal_id' })

  if (error) {
    if (!isMissingCommentsTable(error)) console.warn('AnimeFinder comments: Supabase save failed, note kept locally.', error.message)
    return localSaved
  }

  return { malId, contentHtml, contentText, updatedAt, storage: 'supabase' }
}
