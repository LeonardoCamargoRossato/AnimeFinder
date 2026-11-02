import type { AIProvider } from './AIProvider'
import { normalizeHamletIntent, type HamletProviderRequest, type HamletProviderResponse } from './hamletTypes'
import { isSupabaseConfigured, supabase } from './supabase'

function friendlyHamletError(message: string) {
  const normalized = message.toLowerCase()
  if (normalized.includes('not configured') || normalized.includes('gemini_api_key') || normalized.includes('function not found')) return 'Hamlet is not configured on the secure server yet.'
  return 'Hamlet is temporarily unavailable. Please try again.'
}

export class GeminiProvider implements AIProvider {
  readonly id = 'gemini'
  readonly name = 'Gemini via Supabase Edge Function'

  async sendMessage(request: HamletProviderRequest): Promise<HamletProviderResponse> {
    if (!isSupabaseConfigured || !supabase) throw new Error('Hamlet is not configured on this deployment.')
    try {
      const { data, error } = await supabase.functions.invoke('hamlet-ai', {
        body: {
          message: request.message,
          conversation: request.conversation.slice(-10),
          currentIntent: request.currentIntent,
          preferredModel: request.preferredModel,
          conversationMetadata: request.conversationMetadata ?? null,
        },
      })
      if (error) throw error
      if (!data || typeof data !== 'object') throw new Error('Hamlet returned an invalid response.')
      const row = data as Record<string, unknown>
      if (typeof row.error === 'string') throw new Error(row.error)
      const reply = typeof row.reply === 'string' ? row.reply.trim() : ''
      if (!reply) throw new Error('Hamlet returned an empty response.')
      const metadataRow = row.conversationMetadata && typeof row.conversationMetadata === 'object'
        ? row.conversationMetadata as Record<string, unknown>
        : null
      return {
        reply,
        intent: normalizeHamletIntent(row.intent, request.currentIntent),
        provider: typeof row.provider === 'string' ? row.provider : 'gemini',
        model: typeof row.model === 'string' ? row.model : undefined,
        preferredModel: typeof row.preferredModel === 'string' ? row.preferredModel : request.preferredModel,
        fallbackUsed: row.fallbackUsed === true,
        conversationMetadata: metadataRow ? {
          ready: metadataRow.ready === true,
          title: typeof metadataRow.title === 'string' ? metadataRow.title.trim().slice(0, 120) : null,
          description: typeof metadataRow.description === 'string' ? metadataRow.description.trim().slice(0, 360) : null,
        } : undefined,
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      console.error('Hamlet AI provider request failed.', raw)
      throw new Error(friendlyHamletError(raw))
    }
  }
}

export const hamletAIProvider: AIProvider = new GeminiProvider()
