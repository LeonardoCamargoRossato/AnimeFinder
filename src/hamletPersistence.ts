import { emptyHamletIntent, normalizeHamletIntent, type HamletMessage, type HamletRecommendation, type HamletSearchIntent } from './hamletTypes'
import { DEFAULT_HAMLET_GEMINI_MODEL } from './hamletModels'
import { isSupabaseConfigured, supabase } from './supabase'

export type HamletConversationSource = 'pending' | 'ai' | 'user'

export interface HamletConversationSummary {
  id: string
  title: string
  description: string
  titleSource: HamletConversationSource
  createdAt: string
  updatedAt: string
  lastAccessedAt: string
  accessCount: number
  preferredProvider: string
  preferredModel: string
  lastModelUsed: string | null
  status: 'active' | 'history' | 'archived'
  currentIntent: HamletSearchIntent
  metadata: Record<string, unknown>
}

export interface HamletStoredRecommendation {
  malId: number
  createdAt: string
  metadata: Record<string, unknown>
}

export interface HamletConversationSnapshot {
  conversation: HamletConversationSummary
  messages: HamletMessage[]
  recommendations: HamletStoredRecommendation[]
}

async function currentUser() {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured for Hamlet persistence.')
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new Error('Sign in before using persistent Hamlet conversations.')
  return data.user
}

function mapConversation(row: any): HamletConversationSummary {
  return {
    id: String(row.id),
    title: String(row.title ?? 'Untitled Hamlet Conversation'),
    description: String(row.description ?? ''),
    titleSource: (row.title_source ?? 'pending') as HamletConversationSource,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastAccessedAt: String(row.last_accessed_at),
    accessCount: Number(row.access_count ?? 0),
    preferredProvider: String(row.preferred_provider ?? 'gemini'),
    preferredModel: String(row.preferred_model ?? DEFAULT_HAMLET_GEMINI_MODEL),
    lastModelUsed: row.last_model_used ? String(row.last_model_used) : null,
    status: (row.status ?? 'history') as HamletConversationSummary['status'],
    currentIntent: normalizeHamletIntent(row.current_intent, emptyHamletIntent),
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {},
  }
}

function mapMessage(row: any): HamletMessage {
  return {
    id: String(row.id),
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: String(row.content ?? ''),
    createdAt: String(row.created_at),
    modelUsed: row.model_used ? String(row.model_used) : undefined,
  }
}

export async function createHamletConversation(preferredModel = DEFAULT_HAMLET_GEMINI_MODEL) {
  const user = await currentUser()
  await supabase!.from('hamlet_conversations').update({ status: 'history', updated_at: new Date().toISOString() }).eq('user_id', user.id).eq('status', 'active')
  const { data, error } = await supabase!.from('hamlet_conversations').insert({
    user_id: user.id,
    preferred_provider: 'gemini',
    preferred_model: preferredModel,
    status: 'active',
    current_intent: emptyHamletIntent,
  }).select('*').single()
  if (error || !data) throw new Error(`Could not create Hamlet conversation: ${error?.message ?? 'Unknown error'}`)
  return mapConversation(data)
}

export async function archiveHamletConversation(conversationId: string | null) {
  if (!conversationId || !supabase) return
  const user = await currentUser()
  const { error } = await supabase.from('hamlet_conversations').update({ status: 'history', updated_at: new Date().toISOString() }).eq('id', conversationId).eq('user_id', user.id)
  if (error) throw new Error(`Could not archive Hamlet conversation: ${error.message}`)
}

export async function persistHamletMessage(conversationId: string, message: HamletMessage, modelUsed?: string | null) {
  const user = await currentUser()
  const { error } = await supabase!.from('hamlet_messages').upsert({
    id: message.id,
    conversation_id: conversationId,
    user_id: user.id,
    role: message.role,
    content: message.content,
    created_at: message.createdAt,
    model_used: modelUsed ?? message.modelUsed ?? null,
    metadata: {},
  }, { onConflict: 'id' })
  if (error) throw new Error(`Could not persist Hamlet message: ${error.message}`)
}

export async function persistHamletState(
  conversationId: string,
  values: {
    intent?: HamletSearchIntent
    preferredModel?: string
    lastModelUsed?: string | null
    status?: 'active' | 'history' | 'archived'
    metadata?: Record<string, unknown>
  },
) {
  const user = await currentUser()
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (values.intent) patch.current_intent = values.intent
  if (values.preferredModel) patch.preferred_model = values.preferredModel
  if ('lastModelUsed' in values) patch.last_model_used = values.lastModelUsed ?? null
  if (values.status) patch.status = values.status
  if (values.metadata) patch.metadata = values.metadata
  const { error } = await supabase!.from('hamlet_conversations').update(patch).eq('id', conversationId).eq('user_id', user.id)
  if (error) throw new Error(`Could not persist Hamlet conversation state: ${error.message}`)
}

export async function persistHamletRecommendations(conversationId: string, recommendations: HamletRecommendation[]) {
  const user = await currentUser()
  const { error: deleteError } = await supabase!.from('hamlet_recommendations').delete().eq('conversation_id', conversationId).eq('user_id', user.id)
  if (deleteError) throw new Error(`Could not refresh Hamlet recommendations: ${deleteError.message}`)
  if (!recommendations.length) return
  const rows = recommendations.slice(0, 24).map((row) => ({
    conversation_id: conversationId,
    user_id: user.id,
    mal_id: row.anime.malId,
    metadata: {
      title: row.anime.title,
      titleEnglish: row.anime.titleEnglish ?? null,
      posterUrl: row.anime.imageUrl ?? row.anime.largeImageUrl ?? null,
      score: row.anime.score ?? null,
      year: row.anime.year ?? null,
      type: row.anime.type ?? null,
      episodes: row.anime.episodes ?? null,
      whyMatches: row.whyMatches,
      matchedCriteria: row.matchedCriteria,
      watched: row.watched,
    },
  }))
  const { error } = await supabase!.from('hamlet_recommendations').insert(rows)
  if (error) throw new Error(`Could not persist Hamlet recommendations: ${error.message}`)
}

export async function recordHamletRecommendationAction(conversationId: string, malId: number, action: 'watched' | 'needs_classification') {
  const user = await currentUser()
  const { data, error } = await supabase!.from('hamlet_recommendations').select('metadata').eq('conversation_id', conversationId).eq('user_id', user.id).eq('mal_id', malId).maybeSingle()
  if (error) throw new Error(`Could not read Hamlet recommendation action: ${error.message}`)
  const metadata = data?.metadata && typeof data.metadata === 'object' ? data.metadata as Record<string, unknown> : {}
  const { error: updateError } = await supabase!.from('hamlet_recommendations').update({ metadata: { ...metadata, action, actionAt: new Date().toISOString() } }).eq('conversation_id', conversationId).eq('user_id', user.id).eq('mal_id', malId)
  if (updateError) throw new Error(`Could not persist Hamlet recommendation action: ${updateError.message}`)
}

export async function applyHamletAiMetadata(conversationId: string, title: string, description: string) {
  const user = await currentUser()
  const cleanTitle = title.trim().slice(0, 120)
  const cleanDescription = description.trim().slice(0, 360)
  if (!cleanTitle || !cleanDescription) return
  const { error } = await supabase!.from('hamlet_conversations').update({
    title: cleanTitle,
    description: cleanDescription,
    title_source: 'ai',
    updated_at: new Date().toISOString(),
  }).eq('id', conversationId).eq('user_id', user.id).neq('title_source', 'user')
  if (error) throw new Error(`Could not persist AI conversation metadata: ${error.message}`)
}

export async function updateHamletConversationMetadata(conversationId: string, title: string, description: string) {
  const user = await currentUser()
  const cleanTitle = title.trim().slice(0, 120) || 'Untitled Hamlet Conversation'
  const cleanDescription = description.trim().slice(0, 360)
  const { error } = await supabase!.from('hamlet_conversations').update({
    title: cleanTitle,
    description: cleanDescription,
    title_source: 'user',
    updated_at: new Date().toISOString(),
  }).eq('id', conversationId).eq('user_id', user.id)
  if (error) throw new Error(`Could not update conversation metadata: ${error.message}`)
}

export async function listHamletConversations(limit = 40): Promise<HamletConversationSummary[]> {
  const user = await currentUser()
  const { data, error } = await supabase!.from('hamlet_conversations').select('*').eq('user_id', user.id).neq('status', 'archived').order('last_accessed_at', { ascending: false }).limit(limit)
  if (error) throw new Error(`Could not load Conversation History: ${error.message}`)
  return (data ?? []).map(mapConversation)
}

export async function loadHamletConversation(conversationId: string): Promise<HamletConversationSnapshot> {
  const user = await currentUser()
  const [conversationResult, messagesResult, recommendationsResult] = await Promise.all([
    supabase!.from('hamlet_conversations').select('*').eq('id', conversationId).eq('user_id', user.id).single(),
    supabase!.from('hamlet_messages').select('*').eq('conversation_id', conversationId).eq('user_id', user.id).order('created_at', { ascending: true }),
    supabase!.from('hamlet_recommendations').select('mal_id,created_at,metadata').eq('conversation_id', conversationId).eq('user_id', user.id).order('created_at', { ascending: true }),
  ])
  if (conversationResult.error || !conversationResult.data) throw new Error(`Could not load Hamlet conversation: ${conversationResult.error?.message ?? 'Not found'}`)
  if (messagesResult.error) throw new Error(`Could not load Hamlet messages: ${messagesResult.error.message}`)
  if (recommendationsResult.error) throw new Error(`Could not load Hamlet recommendations: ${recommendationsResult.error.message}`)
  return {
    conversation: mapConversation(conversationResult.data),
    messages: (messagesResult.data ?? []).map(mapMessage),
    recommendations: (recommendationsResult.data ?? []).map((row: any) => ({ malId: Number(row.mal_id), createdAt: String(row.created_at), metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {} })),
  }
}

export async function touchHamletConversation(conversationId: string) {
  const user = await currentUser()
  await supabase!.from('hamlet_conversations').update({ status: 'history', updated_at: new Date().toISOString() }).eq('user_id', user.id).eq('status', 'active').neq('id', conversationId)
  const { data, error } = await supabase!.rpc('touch_hamlet_conversation', { p_conversation_id: conversationId })
  if (error || !data) throw new Error(`Could not continue Hamlet conversation: ${error?.message ?? 'Not found'}`)
  return mapConversation(data)
}

export async function loadLatestHamletConversation() {
  const rows = await listHamletConversations(1)
  return rows[0] ?? null
}
