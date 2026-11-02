import type { Anime } from './types'

export type HamletRole = 'user' | 'assistant'

export interface HamletMessage {
  id: string
  role: HamletRole
  content: string
  createdAt: string
  modelUsed?: string
}

export interface HamletSearchIntent {
  intent: 'anime_discovery'
  readyToSearch: boolean
  query: string
  genres: string[]
  themes: string[]
  concepts: string[]
  avoidGenres: string[]
  avoidConcepts: string[]
  excludeWatched: boolean
  clarificationQuestion: string | null
}

export interface HamletConversationMetadataContext {
  title?: string | null
  description?: string | null
  titleSource?: 'pending' | 'ai' | 'user'
}

export interface HamletGeneratedConversationMetadata {
  ready: boolean
  title: string | null
  description: string | null
}

export interface HamletProviderRequest {
  message: string
  conversation: Array<Pick<HamletMessage, 'role' | 'content'>>
  currentIntent: HamletSearchIntent
  preferredModel?: string
  conversationMetadata?: HamletConversationMetadataContext
}

export interface HamletProviderResponse {
  reply: string
  intent: HamletSearchIntent
  provider: string
  model?: string
  preferredModel?: string
  fallbackUsed?: boolean
  conversationMetadata?: HamletGeneratedConversationMetadata
}

export interface HamletRecommendation {
  anime: Anime
  whyMatches: string
  matchedCriteria: string[]
  watched: boolean
  catalogAction?: 'watched' | 'needs_classification' | null
}

export const emptyHamletIntent: HamletSearchIntent = {
  intent: 'anime_discovery',
  readyToSearch: false,
  query: '',
  genres: [],
  themes: [],
  concepts: [],
  avoidGenres: [],
  avoidConcepts: [],
  excludeWatched: true,
  clarificationQuestion: null,
}

export function normalizeHamletIntent(value: unknown, previous: HamletSearchIntent = emptyHamletIntent): HamletSearchIntent {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const strings = (key: string, fallback: string[]) => Array.isArray(row[key])
    ? Array.from(new Set((row[key] as unknown[]).map(String).map((item) => item.trim()).filter(Boolean))).slice(0, 12)
    : fallback
  const clarification = row.clarificationQuestion == null ? null : String(row.clarificationQuestion).trim() || null
  return {
    intent: 'anime_discovery',
    readyToSearch: typeof row.readyToSearch === 'boolean' ? row.readyToSearch : previous.readyToSearch,
    query: typeof row.query === 'string' ? row.query.trim().slice(0, 180) : previous.query,
    genres: strings('genres', previous.genres),
    themes: strings('themes', previous.themes),
    concepts: strings('concepts', previous.concepts),
    avoidGenres: strings('avoidGenres', previous.avoidGenres),
    avoidConcepts: strings('avoidConcepts', previous.avoidConcepts),
    excludeWatched: typeof row.excludeWatched === 'boolean' ? row.excludeWatched : previous.excludeWatched,
    clarificationQuestion: clarification,
  }
}
