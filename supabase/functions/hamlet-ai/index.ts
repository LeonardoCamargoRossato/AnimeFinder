import { createClient } from 'npm:@supabase/supabase-js@2'

const ALLOWED_EMAIL = 'leo.c.rossato@gmail.com'
const DEFAULT_MODEL = 'gemini-3.5-flash-lite'
const SUPPORTED_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.8-flash',
] as const
const MODEL_TIMEOUT_MS = 10_000
const REQUEST_BUDGET_MS = 38_000
const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions'

const INTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reply: { type: 'string', description: 'Concise conversational Hamlet response in the user language.' },
    intent: {
      type: 'object',
      additionalProperties: false,
      properties: {
        intent: { type: 'string', enum: ['anime_discovery'] },
        readyToSearch: { type: 'boolean' },
        query: { type: 'string' },
        genres: { type: 'array', items: { type: 'string' }, maxItems: 8 },
        themes: { type: 'array', items: { type: 'string' }, maxItems: 8 },
        concepts: { type: 'array', items: { type: 'string' }, maxItems: 10 },
        avoidGenres: { type: 'array', items: { type: 'string' }, maxItems: 8 },
        avoidConcepts: { type: 'array', items: { type: 'string' }, maxItems: 10 },
        excludeWatched: { type: 'boolean' },
        clarificationQuestion: { type: ['string', 'null'] },
      },
      required: ['intent', 'readyToSearch', 'query', 'genres', 'themes', 'concepts', 'avoidGenres', 'avoidConcepts', 'excludeWatched', 'clarificationQuestion'],
    },
    conversationMetadata: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ready: { type: 'boolean' },
        title: { type: ['string', 'null'] },
        description: { type: ['string', 'null'] },
      },
      required: ['ready', 'title', 'description'],
    },
  },
  required: ['reply', 'intent', 'conversationMetadata'],
}

const SYSTEM_INSTRUCTION = `You are Hamlet, AnimeFinder's concise conversational anime-discovery assistant.
Hamlet is the product identity; never call yourself Gemini.
Your job is ONLY to understand the user's discovery intent, clarify ambiguity, explain anime concepts when asked, and return structured search criteria.
Do NOT invent or recommend specific anime titles. Real anime results come from AnimeFinder's catalog provider after your response.
Maintain and update the prior intent across turns rather than restarting it.
Ask one short clarification question when the request is materially ambiguous. If enough criteria exist, set readyToSearch=true and clarificationQuestion=null.
Use standard anime metadata labels when possible, especially genre/theme names such as Fantasy, Adventure, Action, Comedy, Drama, Romance, Sci-Fi, Isekai, Video Game, Strategy Game, Mecha, Mystery, Psychological, Sports, Supernatural.
Put softer semantic ideas such as levels, skills, classes, tactical battles, party-based adventure, strong protagonist, slow burn, or political intrigue in concepts.
Put negative metadata categories in avoidGenres and softer exclusions in avoidConcepts.
Default excludeWatched=true unless the user explicitly wants already-watched titles included.
The query field is a short human-readable summary of the current intent; it is NOT a list of anime titles.
Reply in the language used by the user. Be helpful, curious when clarification improves results, knowledgeable, and not overly verbose.

CONVERSATION METADATA RULES:
You also return conversationMetadata without making any extra AI call. The frontend may persist it as a future Personal Knowledge source.
- Keep title concise, ideally 3–7 words.
- Keep description concise, ideally one sentence.
- If CURRENT CONVERSATION METADATA says titleSource=user, never propose replacement metadata: return ready=false and null title/description.
- If there is not enough context to identify the search meaning, return ready=false and null title/description.
- If metadata is pending and the intent is now meaningful, return ready=true with a useful title and description.
- If metadata was AI-generated already, only return ready=true when the search meaning materially changed enough that the old metadata is misleading; otherwise return ready=false.
Do not produce huge summaries.`

type SupportedModel = typeof SUPPORTED_MODELS[number]

class HamletAttemptError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly transient: boolean,
    readonly code: string,
  ) { super(message) }
}

function corsHeaders(origin: string | null) {
  const allowed = origin === 'https://leonardocamargorossato.github.io' || origin?.startsWith('http://localhost:') || origin?.startsWith('http://127.0.0.1:')
  return {
    'Access-Control-Allow-Origin': allowed && origin ? origin : 'https://leonardocamargorossato.github.io',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })
}

function extractOutputText(payload: any): string {
  const interaction = payload?.interaction ?? payload
  if (typeof interaction?.output_text === 'string') return interaction.output_text
  if (typeof interaction?.outputText === 'string') return interaction.outputText
  const steps = Array.isArray(interaction?.steps) ? interaction.steps : []
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (typeof step?.text === 'string') return step.text
    if (Array.isArray(step?.content)) {
      const joined = step.content.map((part: any) => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('')
      if (joined) return joined
    }
    const content = step?.content
    if (typeof content?.text === 'string') return content.text
    const parts = Array.isArray(content?.parts) ? content.parts : []
    const joined = parts.map((part: any) => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('')
    if (joined) return joined
  }
  return ''
}

function isSupportedModel(value: unknown): value is SupportedModel {
  return typeof value === 'string' && (SUPPORTED_MODELS as readonly string[]).includes(value)
}

function fallbackOrder(preferred: SupportedModel): SupportedModel[] {
  return [preferred, ...SUPPORTED_MODELS.filter((model) => model !== preferred)]
}

function providerErrorText(value: unknown) {
  if (!value || typeof value !== 'object') return ''
  const row = value as Record<string, any>
  return String(row?.error?.message ?? row?.message ?? '').slice(0, 300)
}

function isTransientStatus(status: number, providerMessage = '') {
  if ([408, 429, 500, 502, 503, 504].includes(status)) return true
  if (status === 404 && /model|temporar|unavailable|not found/i.test(providerMessage)) return true
  return false
}

async function callGeminiModel(apiKey: string, model: SupportedModel, input: string, timeoutMs: number) {
  const started = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let response: Response
    try {
      response = await fetch(GEMINI_INTERACTIONS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          system_instruction: SYSTEM_INSTRUCTION,
          input,
          response_format: {
            type: 'text',
            mime_type: 'application/json',
            schema: INTENT_SCHEMA,
          },
        }),
      })
    } catch (error) {
      const durationMs = Date.now() - started
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        console.info('Hamlet model attempt:', { model, status: 'timeout', durationMs })
        throw new HamletAttemptError('Model attempt timed out.', 504, true, 'MODEL_TIMEOUT')
      }
      console.info('Hamlet model attempt:', { model, status: 'network_error', durationMs })
      throw new HamletAttemptError('Temporary Gemini network failure.', 503, true, 'MODEL_NETWORK_ERROR')
    }

    let payload: any = null
    try { payload = await response.json() } catch { payload = null }
    const durationMs = Date.now() - started

    if (!response.ok) {
      const message = providerErrorText(payload)
      console.info('Hamlet model attempt:', { model, status: response.status, durationMs })
      throw new HamletAttemptError(
        'Gemini model request failed.',
        response.status,
        isTransientStatus(response.status, message),
        response.status === 429 ? 'MODEL_RATE_LIMIT' : 'MODEL_PROVIDER_ERROR',
      )
    }

    console.info('Hamlet model attempt:', { model, status: 200, durationMs })
    const output = extractOutputText(payload)
    if (!output) throw new HamletAttemptError('Gemini returned no structured Hamlet output.', 502, false, 'INVALID_MODEL_OUTPUT')

    let parsed: any
    try { parsed = JSON.parse(output) }
    catch { throw new HamletAttemptError('Gemini returned invalid structured output.', 502, false, 'INVALID_MODEL_OUTPUT') }

    const actualModel = typeof payload?.model === 'string'
      ? payload.model
      : typeof payload?.interaction?.model === 'string'
        ? payload.interaction.model
        : model
    return { parsed, actualModel, durationMs }
  } finally {
    clearTimeout(timeout)
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin')
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, origin)

  const authorization = request.headers.get('Authorization')
  if (!authorization) return json({ error: 'Authentication required.' }, 401, origin)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !supabaseAnonKey) return json({ error: 'Supabase server environment is unavailable.' }, 503, origin)

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: authData, error: authError } = await authClient.auth.getUser()
  const user = authData.user
  if (authError || !user) return json({ error: 'Invalid authenticated session.' }, 401, origin)
  if (user.email?.toLowerCase() !== ALLOWED_EMAIL) return json({ error: 'This AnimeFinder account is not authorized for Hamlet.' }, 403, origin)

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return json({ error: 'Hamlet is not configured yet. GEMINI_API_KEY is missing on the secure server.', code: 'HAMLET_NOT_CONFIGURED' }, 503, origin)

  let body: any
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON body.' }, 400, origin) }
  const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 2000) : ''
  if (!message) return json({ error: 'Message is required.' }, 400, origin)
  if (body?.preferredModel != null && !isSupportedModel(body.preferredModel)) return json({ error: 'Unsupported Hamlet model selection.' }, 400, origin)

  const preferredModel: SupportedModel = isSupportedModel(body?.preferredModel) ? body.preferredModel : DEFAULT_MODEL
  const conversation = Array.isArray(body?.conversation) ? body.conversation.slice(-10).map((item: any) => ({ role: item?.role === 'assistant' ? 'assistant' : 'user', content: String(item?.content ?? '').slice(0, 2000) })) : []
  const currentIntent = body?.currentIntent && typeof body.currentIntent === 'object' ? body.currentIntent : {}
  const currentConversationMetadata = body?.conversationMetadata && typeof body.conversationMetadata === 'object'
    ? {
        title: typeof body.conversationMetadata.title === 'string' ? body.conversationMetadata.title.slice(0, 120) : null,
        description: typeof body.conversationMetadata.description === 'string' ? body.conversationMetadata.description.slice(0, 360) : null,
        titleSource: ['pending','ai','user'].includes(body.conversationMetadata.titleSource) ? body.conversationMetadata.titleSource : 'pending',
      }
    : { title: null, description: null, titleSource: 'pending' }

  const input = `CURRENT INTENT:\n${JSON.stringify(currentIntent)}\n\nCURRENT CONVERSATION METADATA:\n${JSON.stringify(currentConversationMetadata)}\n\nRECENT CONVERSATION:\n${conversation.map((item: any) => `${item.role.toUpperCase()}: ${item.content}`).join('\n')}\n\nLATEST USER MESSAGE:\n${message}\n\nReturn Hamlet's conversational reply, the complete updated structured intent, and conversationMetadata according to the metadata rules.`

  const requestStarted = Date.now()
  const attemptedModels: string[] = []
  let lastTransientStatus = 503

  for (const model of fallbackOrder(preferredModel)) {
    const elapsed = Date.now() - requestStarted
    const remaining = REQUEST_BUDGET_MS - elapsed
    if (remaining < 2_000) break
    attemptedModels.push(model)
    if (model !== preferredModel) console.info('Hamlet fallback:', { model })

    try {
      const result = await callGeminiModel(apiKey, model, input, Math.min(MODEL_TIMEOUT_MS, remaining))
      console.info('Hamlet success:', { model: result.actualModel, durationMs: result.durationMs })
      return json({
        ...result.parsed,
        provider: 'gemini',
        model: result.actualModel,
        preferredModel,
        fallbackUsed: result.actualModel !== preferredModel || model !== preferredModel,
      }, 200, origin)
    } catch (error) {
      if (!(error instanceof HamletAttemptError)) {
        console.error('Hamlet provider application failure.', { model })
        return json({ error: 'Hamlet is temporarily unavailable. Please try again.', code: 'HAMLET_PROVIDER_ERROR' }, 502, origin)
      }
      lastTransientStatus = error.status
      if (!error.transient) {
        console.error('Hamlet non-transient provider failure.', { model, status: error.status, code: error.code })
        return json({ error: 'Hamlet is temporarily unavailable. Please try again.', code: error.code }, error.status >= 400 && error.status < 500 ? error.status : 502, origin)
      }
    }
  }

  console.warn('Hamlet all models unavailable.', { attemptedModels, durationMs: Date.now() - requestStarted })
  return json({
    error: 'Hamlet is temporarily unavailable. Please try again.',
    code: 'HAMLET_ALL_MODELS_UNAVAILABLE',
    provider: 'gemini',
    attemptedModels,
  }, lastTransientStatus === 429 ? 429 : 503, origin)
})
