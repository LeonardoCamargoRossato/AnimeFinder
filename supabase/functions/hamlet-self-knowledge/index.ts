import { createClient } from 'npm:@supabase/supabase-js@2'

const ALLOWED_EMAIL = 'leo.c.rossato@gmail.com'
const EMBEDDING_MODEL = 'gemini-embedding-2'
const EMBEDDING_DIMENSIONS = 768
const DEFAULT_REASONING_MODEL = 'gemini-3.5-flash-lite'
const REASONING_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash']
const MAX_EMBED_UPDATES_PER_REQUEST = 18
const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions'
const EMBEDDING_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`

type Domain = 'anime' | 'character' | 'preference'
type QueryRoute = 'structured' | 'statistical' | 'semantic' | 'hybrid' | 'contradiction'

type KnowledgeDraft = {
  domain: Domain
  sourceKey: string
  personalWorkId: string | null
  malId: number | null
  personalCharacterId: string | null
  personalRank: number | null
  characterRank: number | null
  watchStatus: string | null
  category: string | null
  malScore: number | null
  sourceRefs: string[]
  content: string
}

type RankGroup = { label: string; min: number; max: number | null }

type MasterWork = {
  id: string
  displayName: string
  primaryMalId: number | null
  category: string
  watchStatus: string
  myRanked: number | null
  originalObservations: string | null
  comment: string
  malScore: number | null
  keywords: string[]
  genres: string[]
  synopsis?: { original?: string | null; ptBR?: string | null; provider?: string | null }
  characterKnowledge?: Array<{
    id?: string
    rank?: number
    name?: string
    comment?: string
    keywords?: string[]
    externalSources?: Record<string, any>
  }>
}

type MasterSnapshot = { generatedAt?: string; totalWorks?: number; works?: MasterWork[] }

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

function normalizeText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function safeArray(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

function clip(value: string, length = 2200) {
  return value.length > length ? `${value.slice(0, length)}…` : value
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((part) => part.toString(16).padStart(2, '0')).join('')
}

function verifiedExternalNotes(character: any) {
  const rows = Object.values(character?.externalSources ?? {}) as any[]
  const notes: string[] = []
  for (const row of rows) {
    if (!row || row.confirmed === false) continue
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
    const selected = ['role', 'about', 'description', 'occupation', 'abilities']
      .map((key) => metadata[key] ? `${key}: ${normalizeText(metadata[key])}` : '')
      .filter(Boolean)
    if (selected.length) notes.push(selected.join('; '))
  }
  return clip(notes.join(' | '), 1000)
}

function buildKnowledgeDocuments(snapshot: MasterSnapshot): KnowledgeDraft[] {
  const docs: KnowledgeDraft[] = []
  for (const work of safeArray(snapshot.works) as MasterWork[]) {
    const workId = normalizeText(work.id)
    if (!workId) continue
    const title = normalizeText(work.displayName)
    const synopsis = normalizeText(work.synopsis?.ptBR || work.synopsis?.original)
    const genres = safeArray(work.genres).map(normalizeText).filter(Boolean)
    const keywords = safeArray(work.keywords).map(normalizeText).filter(Boolean)
    const comment = normalizeText(work.comment)
    const observations = normalizeText(work.originalObservations)

    const animeContent = [
      `Anime: ${title}`,
      genres.length ? `Genres: ${genres.join(', ')}` : '',
      synopsis ? `Synopsis: ${synopsis}` : '',
    ].filter(Boolean).join('\n')
    if (animeContent) docs.push({
      domain: 'anime', sourceKey: workId, personalWorkId: workId, malId: work.primaryMalId ?? null,
      personalCharacterId: null, personalRank: work.myRanked ?? null, characterRank: null,
      watchStatus: work.watchStatus ?? null, category: work.category ?? null, malScore: work.malScore ?? null,
      sourceRefs: [`personal_catalog_works:${workId}`, `personal_work_external_metadata:${workId}`, `personal_work_synopsis:${workId}`],
      content: clip(animeContent, 6500),
    })

    const preferenceContent = [
      `Personal relationship with: ${title}`,
      keywords.length ? `Personal keywords: ${keywords.join(', ')}` : '',
      comment ? `Personal comment: ${comment}` : '',
      observations && observations !== comment ? `Original observations: ${observations}` : '',
      work.watchStatus ? `Watch status: ${work.watchStatus}` : '',
      work.category ? `Catalog category: ${work.category}` : '',
    ].filter(Boolean).join('\n')
    if (preferenceContent) docs.push({
      domain: 'preference', sourceKey: workId, personalWorkId: workId, malId: work.primaryMalId ?? null,
      personalCharacterId: null, personalRank: work.myRanked ?? null, characterRank: null,
      watchStatus: work.watchStatus ?? null, category: work.category ?? null, malScore: work.malScore ?? null,
      sourceRefs: [`personal_catalog_works:${workId}`, `personal_work_comment_versions:${workId}`, `personal_work_keywords:${workId}`],
      content: clip(preferenceContent, 6500),
    })

    for (const character of safeArray(work.characterKnowledge)) {
      const characterId = normalizeText(character.id || character.name)
      const characterName = normalizeText(character.name)
      if (!characterId || !characterName) continue
      const characterKeywords = safeArray(character.keywords).map(normalizeText).filter(Boolean)
      const characterComment = normalizeText(character.comment)
      const externalNotes = verifiedExternalNotes(character)
      const characterContent = [
        `Character: ${characterName}`,
        `Anime: ${title}`,
        characterKeywords.length ? `Personal character keywords: ${characterKeywords.join(', ')}` : '',
        characterComment ? `Personal character comment: ${characterComment}` : '',
        externalNotes ? `Confirmed external context: ${externalNotes}` : '',
      ].filter(Boolean).join('\n')
      docs.push({
        domain: 'character', sourceKey: `${workId}:${characterId}`, personalWorkId: workId, malId: work.primaryMalId ?? null,
        personalCharacterId: characterId, personalRank: work.myRanked ?? null, characterRank: Number(character.rank) || null,
        watchStatus: work.watchStatus ?? null, category: work.category ?? null, malScore: work.malScore ?? null,
        sourceRefs: [`personal_work_characters:${workId}:${characterId}`, `personal_character_comments:${workId}:${characterId}`, `personal_character_keywords:${workId}:${characterId}`, `personal_character_external_sources:${workId}:${characterId}`],
        content: clip(characterContent, 6500),
      })
    }
  }
  return docs
}

async function embedText(apiKey: string, text: string, kind: 'document' | 'query') {
  const prefix = kind === 'query'
    ? 'Retrieval query about the user’s personal anime preferences and catalog evidence:\n'
    : 'Evidence document from the user’s personal AnimeFinder knowledge base. Retrieve this when it helps answer a question about preferences, works, rankings, comments, or characters:\n'
  const response = await fetch(EMBEDDING_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      content: { parts: [{ text: `${prefix}${clip(text, 7000)}` }] },
      output_dimensionality: EMBEDDING_DIMENSIONS,
    }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`Embedding provider failed (${response.status}).`)
  const values = payload?.embedding?.values ?? payload?.embeddings?.[0]?.values
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) throw new Error('Embedding provider returned an invalid vector.')
  return values.map(Number)
}

async function mapLimit<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function runner() {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runner()))
  return results
}

async function loadMasterSnapshot(client: any): Promise<MasterSnapshot> {
  const { data, error } = await client.rpc('get_master_data_snapshot')
  if (error) throw new Error(`Master Data unavailable: ${error.message}`)
  return (data ?? { works: [] }) as MasterSnapshot
}

async function syncDerivedKnowledge(client: any, userId: string, apiKey: string, maxUpdates = MAX_EMBED_UPDATES_PER_REQUEST) {
  const snapshot = await loadMasterSnapshot(client)
  const drafts = buildKnowledgeDocuments(snapshot)
  const { data: existingRows, error: existingError } = await client.from('self_knowledge_documents')
    .select('id,domain,source_key,content_hash,embedding_model,embedding_dimensions')
  if (existingError) throw new Error(`Self-Knowledge migration is not ready: ${existingError.message}`)

  const existing = safeArray(existingRows)
  const existingMap = new Map(existing.map((row: any) => [`${row.domain}:${row.source_key}`, row]))
  const prepared = await Promise.all(drafts.map(async (draft) => {
    const hashMaterial = JSON.stringify({
      content: draft.content,
      personalRank: draft.personalRank,
      characterRank: draft.characterRank,
      watchStatus: draft.watchStatus,
      category: draft.category,
      malScore: draft.malScore,
      sourceRefs: draft.sourceRefs,
    })
    return { draft, contentHash: await sha256(hashMaterial) }
  }))

  const domainPriority: Record<Domain, number> = { preference: 0, character: 1, anime: 2 }
  const changed = prepared.filter(({ draft, contentHash }) => {
    const row = existingMap.get(`${draft.domain}:${draft.sourceKey}`)
    return !row || row.content_hash !== contentHash || row.embedding_model !== EMBEDDING_MODEL || Number(row.embedding_dimensions) !== EMBEDDING_DIMENSIONS
  }).sort((a, b) => domainPriority[a.draft.domain] - domainPriority[b.draft.domain])

  const batch = changed.slice(0, Math.max(1, Math.min(maxUpdates, 30)))
  let embedded = 0
  let embeddingFailures = 0

  await mapLimit(batch, 3, async ({ draft, contentHash }) => {
    try {
      const embedding = await embedText(apiKey, draft.content, 'document')
      const { error } = await client.from('self_knowledge_documents').upsert({
        user_id: userId,
        domain: draft.domain,
        source_key: draft.sourceKey,
        personal_work_id: draft.personalWorkId,
        mal_id: draft.malId,
        personal_character_id: draft.personalCharacterId,
        personal_rank: draft.personalRank,
        character_rank: draft.characterRank,
        watch_status: draft.watchStatus,
        category: draft.category,
        mal_score: draft.malScore,
        source_refs: draft.sourceRefs,
        content: draft.content,
        content_hash: contentHash,
        embedding_provider: 'google-gemini-api',
        embedding_model: EMBEDDING_MODEL,
        embedding_dimensions: EMBEDDING_DIMENSIONS,
        embedding,
        embedded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,domain,source_key' })
      if (error) throw error
      embedded += 1
    } catch (error) {
      embeddingFailures += 1
      console.warn('Self-Knowledge document embedding failed.', { domain: draft.domain, sourceKey: draft.sourceKey, error: error instanceof Error ? error.message : String(error) })
    }
  })

  const draftKeys = new Set(drafts.map((draft) => `${draft.domain}:${draft.sourceKey}`))
  const staleIds = existing.filter((row: any) => !draftKeys.has(`${row.domain}:${row.source_key}`)).map((row: any) => row.id)
  if (staleIds.length) await client.from('self_knowledge_documents').delete().in('id', staleIds)

  const { data: status } = await client.rpc('get_self_knowledge_index_status')
  return {
    snapshot,
    status: status ?? {},
    totalDerivedDocuments: drafts.length,
    changedDocuments: changed.length,
    embeddedThisRequest: embedded,
    pendingEmbeddings: Math.max(0, changed.length - batch.length) + embeddingFailures,
    embeddingFailures,
    removedStaleDocuments: staleIds.length,
  }
}

function classifyQuestion(question: string): { route: QueryRoute; domains: Domain[] } {
  const q = question.toLocaleLowerCase('pt-BR')
  if (/contradi|inconsist|diverg|conflict/.test(q)) return { route: 'contradiction', domains: ['preference', 'anime'] }
  const hasStats = /top\s*\d+|rank|ranking|posição|posiç|frequ|percent|%|gênero|genero|keyword|tema|compare|compar|aband|drop/.test(q)
  const hasSemantic = /coment|fala|psicol|por que|porque|motivo|gosto|prefer|padrão|padrao|intelig|personag|característica|caracteristica/.test(q)
  if (hasStats && hasSemantic) return { route: 'hybrid', domains: /personag|caracter/.test(q) ? ['character', 'preference', 'anime'] : ['preference', 'anime', 'character'] }
  if (hasStats) return { route: 'statistical', domains: /personag|caracter/.test(q) ? ['character', 'preference'] : ['preference', 'anime'] }
  if (hasSemantic) return { route: 'semantic', domains: /personag|caracter/.test(q) ? ['character', 'preference'] : ['preference', 'anime', 'character'] }
  return { route: 'structured', domains: ['preference', 'anime', 'character'] }
}

function parseRankGroups(question: string): RankGroup[] {
  const groups: RankGroup[] = []
  const top = Array.from(question.matchAll(/top\s*(\d+)/gi)).map((m) => Number(m[1])).filter((n) => n > 0)
  for (const n of top) groups.push({ label: `Top ${n}`, min: 1, max: n })
  const ranges = Array.from(question.matchAll(/(?:posi(?:ç|c)(?:ões|oes)?|rank(?:ing)?|entre)?\s*(\d+)\s*(?:-|–|—|a|até|ate|e)\s*(\d+)/gi))
  for (const match of ranges) {
    const a = Number(match[1]); const b = Number(match[2])
    if (a > 0 && b >= a && !groups.some((group) => group.min === a && group.max === b)) groups.push({ label: `Rank ${a}–${b}`, min: a, max: b })
  }
  return groups.slice(0, 3)
}

function rankedWorks(works: MasterWork[], group: RankGroup) {
  return works.filter((work) => work.myRanked != null && work.myRanked >= group.min && (group.max == null || work.myRanked <= group.max))
}

function frequency(items: string[], sampleSize: number, limit = 10) {
  const counts = new Map<string, number>()
  for (const raw of items) {
    const key = normalizeText(raw)
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([label, count]) => ({ label, count, pct: sampleSize ? Math.round((count / sampleSize) * 1000) / 10 : 0 }))
}

function statsForGroup(label: string, works: MasterWork[]) {
  const keywords = works.flatMap((work) => safeArray(work.keywords).map(String))
  const genres = works.flatMap((work) => safeArray(work.genres).map(String))
  const characterKeywords = works.flatMap((work) => safeArray(work.characterKnowledge).flatMap((character: any) => safeArray(character.keywords).map(String)))
  return {
    label,
    sampleSize: works.length,
    keywordFrequency: frequency(keywords, works.length, 10),
    genreFrequency: frequency(genres, works.length, 10),
    characterKeywordFrequency: frequency(characterKeywords, works.length, 10),
    averageMalScore: works.filter((work) => work.malScore != null).length
      ? Math.round((works.filter((work) => work.malScore != null).reduce((sum, work) => sum + Number(work.malScore), 0) / works.filter((work) => work.malScore != null).length) * 100) / 100
      : null,
  }
}

const POSITIVE_WORDS = /excelent|ótim|otim|gosto|ador|amo|genial|melhor|favorit|incrível|incrivel|fantást|fantast|perfeit|brilhant/i
const NEGATIVE_WORDS = /ruim|fraco|decepcion|odeio|chato|pior|problem|falha|negativ|cansat|medíocre|mediocre|abandon/i

function possibleContradictions(works: MasterWork[]) {
  const rows: any[] = []
  for (const work of works) {
    const text = `${work.comment ?? ''} ${work.originalObservations ?? ''}`.trim()
    if (!text) continue
    const positive = POSITIVE_WORDS.test(text)
    const negative = NEGATIVE_WORDS.test(text)
    const rank = work.myRanked
    const dropped = work.watchStatus === 'dropped' || work.watchStatus === 'unfinished' || work.category === 'dropped-unfinished'
    let reason = ''
    if (rank != null && rank <= 25 && negative && !positive) reason = 'high personal rank with predominantly negative wording'
    else if (rank != null && rank >= 100 && positive && !negative) reason = 'low personal rank with strongly positive wording'
    else if (dropped && positive && !negative) reason = 'dropped/unfinished status with strongly positive wording'
    if (reason) rows.push({ work: work.displayName, personalRank: rank, watchStatus: work.watchStatus, reason, excerpt: clip(text, 240) })
  }
  return rows.slice(0, 12)
}

function buildStructuredEvidence(question: string, snapshot: MasterSnapshot) {
  const works = safeArray(snapshot.works) as MasterWork[]
  const ranked = works.filter((work) => work.myRanked != null).sort((a, b) => Number(a.myRanked) - Number(b.myRanked))
  const groups = parseRankGroups(question)
  const requestedGroups = groups.length ? groups : [{ label: 'Top 25', min: 1, max: 25 }]
  const groupStats = requestedGroups.map((group) => statsForGroup(group.label, rankedWorks(works, group)))

  if (/compar|diferen|versus|vs\.?/i.test(question) && groupStats.length === 1) {
    const first = requestedGroups[0]
    const comparison: RankGroup = first.max != null
      ? { label: `Rank ${first.max + 1}+`, min: first.max + 1, max: null }
      : { label: 'Rank 101+', min: 101, max: null }
    groupStats.push(statsForGroup(comparison.label, rankedWorks(works, comparison)))
  }

  const dropped = works.filter((work) => work.watchStatus === 'dropped' || work.watchStatus === 'unfinished' || work.category === 'dropped-unfinished')
  const watched = works.filter((work) => work.watchStatus === 'watched' || work.category === 'watched')
  const favoriteCharacters = ranked.flatMap((work) => safeArray(work.characterKnowledge)
    .filter((character: any) => Number(character.rank) > 0 && Number(character.rank) <= 3)
    .map((character: any) => ({ work: work.displayName, workRank: work.myRanked, character: normalizeText(character.name), characterRank: Number(character.rank), keywords: safeArray(character.keywords).map(String) })))

  return {
    catalog: {
      totalWorks: works.length,
      rankedWorks: ranked.length,
      watchedWorks: watched.length,
      droppedOrUnfinishedWorks: dropped.length,
      topRankedExamples: ranked.slice(0, 10).map((work) => ({ rank: work.myRanked, work: work.displayName, keywords: work.keywords, genres: work.genres })),
    },
    rankGroups: groupStats,
    droppedComparison: /aband|drop|unfinished|watched|assistid/i.test(question)
      ? { dropped: statsForGroup('Dropped / unfinished', dropped), watched: statsForGroup('Watched', watched) }
      : undefined,
    favoriteCharacters: /personag|caracter|protagon/i.test(question)
      ? { sampleSize: favoriteCharacters.length, keywordFrequency: frequency(favoriteCharacters.flatMap((row) => row.keywords), favoriteCharacters.length, 12), examples: favoriteCharacters.slice(0, 18) }
      : undefined,
    possibleContradictions: /contradi|inconsist|diverg|conflict/i.test(question) ? possibleContradictions(works) : undefined,
  }
}

async function semanticSearch(client: any, apiKey: string, question: string, domains: Domain[]) {
  try {
    const queryEmbedding = await embedText(apiKey, question, 'query')
    const { data, error } = await client.rpc('match_self_knowledge_documents', {
      p_query_embedding: queryEmbedding,
      p_match_count: 12,
      p_domains: domains,
    })
    if (error) throw error
    return safeArray(data).map((row: any) => ({
      domain: row.domain,
      personalWorkId: row.personal_work_id,
      malId: row.mal_id,
      personalCharacterId: row.personal_character_id,
      personalRank: row.personal_rank,
      characterRank: row.character_rank,
      watchStatus: row.watch_status,
      category: row.category,
      malScore: row.mal_score,
      similarity: Math.round(Number(row.similarity) * 1000) / 1000,
      sourceRefs: row.source_refs,
      content: clip(normalizeText(row.content), 1000),
    }))
  } catch (error) {
    console.warn('Self-Knowledge semantic retrieval unavailable.', error instanceof Error ? error.message : String(error))
    return []
  }
}

function extractOutputText(payload: any): string {
  const interaction = payload?.interaction ?? payload
  if (typeof interaction?.output_text === 'string') return interaction.output_text
  if (typeof interaction?.outputText === 'string') return interaction.outputText
  const steps = Array.isArray(interaction?.steps) ? interaction.steps : []
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (typeof step?.text === 'string') return step.text
    const content = Array.isArray(step?.content) ? step.content : step?.content?.parts
    if (Array.isArray(content)) {
      const joined = content.map((part: any) => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('')
      if (joined) return joined
    }
  }
  return ''
}

async function reasonWithGemini(apiKey: string, question: string, recentConversation: any[], route: QueryRoute, evidence: any) {
  const system = `You are Hamlet AI Self-Knowledge Engine inside AnimeFinder. Hamlet is the product identity; never call yourself Gemini.
Answer in the user's language. Use ONLY the supplied evidence package; do not invent preferences or catalog facts.
Ranking is an ordinal PERSONAL RANKING, not a rating. Never conflate it with MAL score or any rating.
Be evidence-first. Structure the answer with three concise sections named DATA, ANALYSIS, and INTERPRETATION (translated naturally if the user is speaking Portuguese).
DATA: report concrete counts, percentages, sample sizes, rankings, retrieved comments/keywords, or named examples that are actually present.
ANALYSIS: explain comparisons/patterns supported by those data. Do not claim statistical correlation or causality from small samples.
INTERPRETATION: offer cautious personal interpretation. Clearly label uncertainty and say when evidence is insufficient.
Potential contradictions are hypotheses only; call them possible contradictions and explain the supporting evidence.
Do not dump the entire database. Prefer a few decisive examples and numbers.`

  const input = `QUERY ROUTE: ${route}\n\nRECENT SELF-KNOWLEDGE CONVERSATION:\n${recentConversation.slice(-8).map((row: any) => `${row.role === 'assistant' ? 'HAMLET' : 'USER'}: ${clip(normalizeText(row.content), 1000)}`).join('\n')}\n\nUSER QUESTION:\n${question}\n\nEVIDENCE PACKAGE:\n${clip(JSON.stringify(evidence), 26000)}\n\nAnswer strictly from this evidence.`

  let lastStatus = 503
  for (const model of REASONING_MODELS) {
    const response = await fetch(GEMINI_INTERACTIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ model, system_instruction: system, input, response_format: { type: 'text' } }),
    }).catch(() => null)
    if (!response) continue
    lastStatus = response.status
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      if ([408, 429, 500, 502, 503, 504].includes(response.status)) continue
      throw new Error(`Reasoning provider failed (${response.status}).`)
    }
    const reply = extractOutputText(payload).trim()
    if (reply) return { reply, model: typeof payload?.model === 'string' ? payload.model : model }
  }
  throw new Error(`Hamlet reasoning is temporarily unavailable (${lastStatus}).`)
}

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin')
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, origin)

  const authorization = request.headers.get('Authorization')
  if (!authorization) return json({ error: 'Authentication required.' }, 401, origin)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!supabaseUrl || !supabaseAnonKey) return json({ error: 'Supabase server environment is unavailable.' }, 503, origin)
  if (!apiKey) return json({ error: 'Hamlet Self-Knowledge is not configured. GEMINI_API_KEY is missing.', code: 'SELF_KNOWLEDGE_NOT_CONFIGURED' }, 503, origin)

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    db: { schema: 'animefinder' },
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: authData, error: authError } = await client.auth.getUser()
  const user = authData.user
  if (authError || !user) return json({ error: 'Invalid authenticated session.' }, 401, origin)
  if (user.email?.toLowerCase() !== ALLOWED_EMAIL) return json({ error: 'This AnimeFinder account is not authorized for Hamlet.' }, 403, origin)

  let body: any
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON body.' }, 400, origin) }
  const operation = body?.operation === 'sync' ? 'sync' : 'ask'
  const syncBatchSize = Math.max(1, Math.min(Number(body?.syncBatchSize) || MAX_EMBED_UPDATES_PER_REQUEST, 30))

  try {
    const sync = await syncDerivedKnowledge(client, user.id, apiKey, syncBatchSize)
    if (operation === 'sync') {
      return json({
        ok: true,
        embedding: { provider: 'Google Gemini API', model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS },
        sync: { ...sync, snapshot: undefined },
      }, 200, origin)
    }

    const message = normalizeText(body?.message).slice(0, 4000)
    if (!message) return json({ error: 'Message is required.' }, 400, origin)
    const conversation = safeArray(body?.conversation).slice(-10).map((row: any) => ({ role: row?.role === 'assistant' ? 'assistant' : 'user', content: normalizeText(row?.content).slice(0, 2500) }))
    const classification = classifyQuestion(message)
    const structuredEvidence = buildStructuredEvidence(message, sync.snapshot)
    const semanticEvidence = await semanticSearch(client, apiKey, message, classification.domains)
    const evidencePackage = {
      queryClassification: classification,
      indexCoverage: {
        totalDerivedDocuments: sync.totalDerivedDocuments,
        indexedDocuments: Number(sync.status?.embedded) || 0,
        pendingEmbeddings: sync.pendingEmbeddings,
        embeddedThisRequest: sync.embeddedThisRequest,
      },
      structuredEvidence,
      semanticEvidence,
      methodology: {
        sourceOfTruth: 'Supabase normalized AnimeFinder data',
        rankingMeaning: 'personal ordinal ranking; not a rating',
        semanticDomains: ['anime', 'character', 'preference'],
        embeddingModel: EMBEDDING_MODEL,
      },
    }
    const result = await reasonWithGemini(apiKey, message, conversation, classification.route, evidencePackage)
    return json({
      reply: result.reply,
      route: classification.route,
      domains: classification.domains,
      provider: 'gemini',
      model: result.model,
      embedding: { provider: 'Google Gemini API', model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS },
      index: evidencePackage.indexCoverage,
      evidenceSummary: {
        totalWorks: structuredEvidence.catalog.totalWorks,
        rankedWorks: structuredEvidence.catalog.rankedWorks,
        semanticMatches: semanticEvidence.length,
        rankGroups: structuredEvidence.rankGroups.map((row: any) => ({ label: row.label, sampleSize: row.sampleSize })),
        possibleContradictions: structuredEvidence.possibleContradictions?.length ?? 0,
      },
    }, 200, origin)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Hamlet Self-Knowledge failure.', message)
    const setup = /self-knowledge migration|self_knowledge_documents|match_self_knowledge|get_self_knowledge|relation .* does not exist|schema cache/i.test(message)
    return json({
      error: setup
        ? 'Hamlet Self-Knowledge database layer is not installed yet. Run the V1 migration in the AnimeFinder Supabase SQL Editor and deploy the hamlet-self-knowledge Edge Function.'
        : 'Hamlet Self-Knowledge is temporarily unavailable. Please try again.',
      code: setup ? 'SELF_KNOWLEDGE_MIGRATION_REQUIRED' : 'SELF_KNOWLEDGE_ERROR',
      detail: message.slice(0, 500),
    }, setup ? 503 : 502, origin)
  }
})
