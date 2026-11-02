export type HamletProviderId = 'gemini' | 'openai' | 'anthropic'

export interface HamletModelOption {
  id: string
  label: string
  provider: HamletProviderId
}

export const DEFAULT_HAMLET_GEMINI_MODEL = 'gemini-3.5-flash-lite'

export const HAMLET_GEMINI_MODELS: HamletModelOption[] = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', provider: 'gemini' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', provider: 'gemini' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', provider: 'gemini' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', provider: 'gemini' },
]

export const HAMLET_PROVIDER_OPTIONS = [
  { id: 'gemini' as const, label: 'Gemini', available: true },
  { id: 'openai' as const, label: 'GPT', available: false },
  { id: 'anthropic' as const, label: 'Claude', available: false },
]

export function hamletModelLabel(modelId?: string | null) {
  if (!modelId) return 'Gemini 3.5 Flash-Lite'
  return HAMLET_GEMINI_MODELS.find((item) => item.id === modelId)?.label ?? modelId
}

export function isSupportedHamletGeminiModel(modelId: string) {
  return HAMLET_GEMINI_MODELS.some((item) => item.id === modelId)
}
