import type { AIProvider } from './AIProvider'
import { normalizeHamletIntent, type HamletProviderRequest, type HamletProviderResponse } from './hamletTypes'
import { isSupabaseConfigured, supabase } from './supabase'

function friendlyHamletError(message: string) {
  const normalized = message.toLowerCase()
  if (normalized.includes('429') || normalized.includes('rate') || normalized.includes('quota')) return 'Hamlet reached the current AI quota. Please try again later.'
  if (normalized.includes('not configured') || normalized.includes('gemini_api_key') || normalized.includes('function not found')) return 'Hamlet is not configured on the secure server yet.'
  if (normalized.includes('timeout') || normalized.includes('network') || normalized.includes('fetch')) return 'Hamlet is temporarily unavailable because of a network problem. Please try again.'
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
        },
      })
      if (error) throw error
      if (!data || typeof data !== 'object') throw new Error('Hamlet returned an invalid response.')
      const row = data as Record<string, unknown>
      const reply = typeof row.reply === 'string' ? row.reply.trim() : ''
      if (!reply) throw new Error('Hamlet returned an empty response.')
      return {
        reply,
        intent: normalizeHamletIntent(row.intent, request.currentIntent),
        provider: typeof row.provider === 'string' ? row.provider : 'gemini',
        model: typeof row.model === 'string' ? row.model : undefined,
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      console.error('Hamlet AI provider request failed.', raw)
      throw new Error(friendlyHamletError(raw))
    }
  }
}

export const hamletAIProvider: AIProvider = new GeminiProvider()
