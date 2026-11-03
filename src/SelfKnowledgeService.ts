import { isSupabaseConfigured, supabase } from './supabase'
import type {
  SelfKnowledgeAnswer,
  SelfKnowledgeConversationMessage,
  SelfKnowledgeSyncStatus,
} from './selfKnowledgeTypes'

function friendlySelfKnowledgeError(raw: string) {
  const message = raw.toLowerCase()
  if (
    message.includes('self_knowledge_migration_required') ||
    message.includes('migration') ||
    message.includes('self_knowledge_documents') ||
    message.includes('function not found') ||
    message.includes('schema cache')
  ) {
    return 'Hamlet Self-Knowledge still needs its Supabase V1 migration and Edge Function deployment.'
  }
  if (message.includes('not configured') || message.includes('gemini_api_key')) {
    return 'Hamlet Self-Knowledge is not configured on the secure server yet.'
  }
  return 'Hamlet Self-Knowledge is temporarily unavailable. Please try again.'
}

async function invokeSelfKnowledge(body: Record<string, unknown>) {
  if (!isSupabaseConfigured || !supabase) throw new Error('Hamlet Self-Knowledge is not configured on this deployment.')
  try {
    const { data, error } = await supabase.functions.invoke('hamlet-self-knowledge', { body })
    if (error) throw error
    if (!data || typeof data !== 'object') throw new Error('Hamlet Self-Knowledge returned an invalid response.')
    const row = data as Record<string, any>
    if (typeof row.error === 'string') throw new Error(`${row.code ?? ''} ${row.error} ${row.detail ?? ''}`.trim())
    return row
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    console.error('Hamlet Self-Knowledge request failed.', raw)
    throw new Error(friendlySelfKnowledgeError(raw))
  }
}

export class SelfKnowledgeService {
  async semanticSearch() {
    throw new Error('semanticSearch is server-routed in V1. Use ask() so evidence stays behind the secure Self-Knowledge service.')
  }

  async compareRankGroups() {
    throw new Error('compareRankGroups is server-routed in V1. Use ask() so structured evidence stays server-side.')
  }

  async analyzeKeywords() {
    throw new Error('analyzeKeywords is server-routed in V1. Use ask() so structured evidence stays server-side.')
  }

  async analyzeGenres() {
    throw new Error('analyzeGenres is server-routed in V1. Use ask() so structured evidence stays server-side.')
  }

  async analyzeCharacters() {
    throw new Error('analyzeCharacters is server-routed in V1. Use ask() so structured evidence stays server-side.')
  }

  async analyzeDropped() {
    throw new Error('analyzeDropped is server-routed in V1. Use ask() so structured evidence stays server-side.')
  }

  async findContradictions() {
    throw new Error('findContradictions is server-routed in V1. Use ask() so evidence stays server-side.')
  }

  async getStructuredEvidence() {
    throw new Error('getStructuredEvidence is server-routed in V1. Use ask() so Master Data is never copied wholesale to the browser.')
  }

  async ask(message: string, conversation: SelfKnowledgeConversationMessage[]): Promise<SelfKnowledgeAnswer> {
    const row = await invokeSelfKnowledge({
      operation: 'ask',
      message,
      conversation: conversation.slice(-10).map(({ role, content }) => ({ role, content })),
      syncBatchSize: 18,
    })

    if (typeof row.reply !== 'string' || !row.reply.trim()) throw new Error('Hamlet Self-Knowledge returned an empty answer.')
    return {
      reply: row.reply.trim(),
      route: row.route ?? 'hybrid',
      domains: Array.isArray(row.domains) ? row.domains : [],
      provider: typeof row.provider === 'string' ? row.provider : 'gemini',
      model: typeof row.model === 'string' ? row.model : undefined,
      embedding: {
        provider: String(row.embedding?.provider ?? 'Google Gemini API'),
        model: String(row.embedding?.model ?? 'gemini-embedding-2'),
        dimensions: Number(row.embedding?.dimensions) || 768,
      },
      index: {
        totalDerivedDocuments: Number(row.index?.totalDerivedDocuments) || 0,
        indexedDocuments: Number(row.index?.indexedDocuments) || 0,
        pendingEmbeddings: Number(row.index?.pendingEmbeddings) || 0,
        embeddedThisRequest: Number(row.index?.embeddedThisRequest) || 0,
      },
      evidenceSummary: {
        totalWorks: Number(row.evidenceSummary?.totalWorks) || 0,
        rankedWorks: Number(row.evidenceSummary?.rankedWorks) || 0,
        semanticMatches: Number(row.evidenceSummary?.semanticMatches) || 0,
        rankGroups: Array.isArray(row.evidenceSummary?.rankGroups) ? row.evidenceSummary.rankGroups : [],
        possibleContradictions: Number(row.evidenceSummary?.possibleContradictions) || 0,
      },
    }
  }

  async sync(batchSize = 12): Promise<SelfKnowledgeSyncStatus> {
    const row = await invokeSelfKnowledge({ operation: 'sync', syncBatchSize: batchSize })
    return {
      embedding: {
        provider: String(row.embedding?.provider ?? 'Google Gemini API'),
        model: String(row.embedding?.model ?? 'gemini-embedding-2'),
        dimensions: Number(row.embedding?.dimensions) || 768,
      },
      sync: {
        status: row.sync?.status ?? {},
        totalDerivedDocuments: Number(row.sync?.totalDerivedDocuments) || 0,
        changedDocuments: Number(row.sync?.changedDocuments) || 0,
        embeddedThisRequest: Number(row.sync?.embeddedThisRequest) || 0,
        pendingEmbeddings: Number(row.sync?.pendingEmbeddings) || 0,
        embeddingFailures: Number(row.sync?.embeddingFailures) || 0,
        removedStaleDocuments: Number(row.sync?.removedStaleDocuments) || 0,
      },
    }
  }
}

export const selfKnowledgeService = new SelfKnowledgeService()
