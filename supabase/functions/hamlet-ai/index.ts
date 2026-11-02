import { GoogleGenAI } from 'npm:@google/genai'
import { createClient } from 'npm:@supabase/supabase-js@2'

const ALLOWED_EMAIL = 'leo.c.rossato@gmail.com'
const DEFAULT_MODEL = 'gemini-3.8-flash'

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
  },
  required: ['reply', 'intent'],
}

const SYSTEM_INSTRUCTION = `You are Hamlet, AnimeFinder's concise conversational anime-discovery assistant.
Hamlet is the product identity; never call yourself Gemini.
Your job in V1 is ONLY to understand the user's discovery intent, clarify ambiguity, explain anime concepts when asked, and return structured search criteria.
Do NOT invent or recommend specific anime titles. Real anime results come from AnimeFinder's catalog provider after your response.
Maintain and update the prior intent across turns rather than restarting it.
Ask one short clarification question when the request is materially ambiguous. If enough criteria exist, set readyToSearch=true and clarificationQuestion=null.
Use standard anime metadata labels when possible, especially genre/theme names such as Fantasy, Adventure, Action, Comedy, Drama, Romance, Sci-Fi, Isekai, Video Game, Strategy Game, Mecha, Mystery, Psychological, Sports, Supernatural.
Put softer semantic ideas such as levels, skills, classes, tactical battles, party-based adventure, strong protagonist, slow burn, or political intrigue in concepts.
Put negative metadata categories in avoidGenres and softer exclusions in avoidConcepts.
Default excludeWatched=true unless the user explicitly wants already-watched titles included.
The query field is a short human-readable summary of the current intent; it is NOT a list of anime titles.
Reply in the language used by the user. Be helpful, curious when clarification improves results, knowledgeable, and not overly verbose.`

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

function extractOutputText(interaction: any): string {
  if (typeof interaction?.output_text === 'string') return interaction.output_text
  if (typeof interaction?.outputText === 'string') return interaction.outputText
  const steps = Array.isArray(interaction?.steps) ? interaction.steps : []
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (typeof step?.text === 'string') return step.text
    const content = step?.content
    if (typeof content?.text === 'string') return content.text
    const parts = Array.isArray(content?.parts) ? content.parts : []
    const joined = parts.map((part: any) => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('')
    if (joined) return joined
  }
  return ''
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
  const model = Deno.env.get('HAMLET_GEMINI_MODEL') || DEFAULT_MODEL

  let body: any
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON body.' }, 400, origin) }
  const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 2000) : ''
  if (!message) return json({ error: 'Message is required.' }, 400, origin)
  const conversation = Array.isArray(body?.conversation) ? body.conversation.slice(-10).map((item: any) => ({ role: item?.role === 'assistant' ? 'assistant' : 'user', content: String(item?.content ?? '').slice(0, 2000) })) : []
  const currentIntent = body?.currentIntent && typeof body.currentIntent === 'object' ? body.currentIntent : {}

  const input = `CURRENT INTENT:\n${JSON.stringify(currentIntent)}\n\nRECENT CONVERSATION:\n${conversation.map((item: any) => `${item.role.toUpperCase()}: ${item.content}`).join('\n')}\n\nLATEST USER MESSAGE:\n${message}\n\nReturn Hamlet's conversational reply plus the complete updated structured intent.`

  try {
    const ai = new GoogleGenAI({ apiKey })
    const interaction = await ai.interactions.create({
      model,
      system_instruction: SYSTEM_INSTRUCTION,
      input,
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: INTENT_SCHEMA,
      },
    } as any)
    const output = extractOutputText(interaction)
    if (!output) return json({ error: 'Gemini returned no structured Hamlet output.' }, 502, origin)
    let parsed: any
    try { parsed = JSON.parse(output) } catch { return json({ error: 'Gemini returned invalid structured output.' }, 502, origin) }
    return json({ ...parsed, provider: 'gemini', model }, 200, origin)
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error)
    const lower = messageText.toLowerCase()
    const status = lower.includes('429') || lower.includes('quota') || lower.includes('resource_exhausted') ? 429 : lower.includes('timeout') ? 504 : 502
    console.error('Hamlet Gemini provider failed.', { status, model, error: messageText.slice(0, 400) })
    return json({ error: status === 429 ? 'Hamlet reached the current Gemini quota. Please try again later.' : 'Hamlet is temporarily unavailable. Please try again.', code: status === 429 ? 'HAMLET_RATE_LIMIT' : 'HAMLET_PROVIDER_ERROR' }, status, origin)
  }
})
