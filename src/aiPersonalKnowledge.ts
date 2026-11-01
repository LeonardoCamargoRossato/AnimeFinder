import { isSupabaseConfigured, supabase } from './supabase'

export type VersionSource = 'manual' | 'voice' | 'ai_organized' | 'restored'
export type KnowledgeSource = 'manual' | 'ai_suggested'

export interface CommentVersion {
  id: string
  versionNumber: number
  content: string
  source: VersionSource
  createdAt: string
}

export interface KnowledgeKeyword {
  label: string
  rank: number
  source: KnowledgeSource
  confirmed: boolean
  confidence?: number | null
}

export interface CharacterKnowledge {
  id: string
  name: string
  rank: number
  confirmed: boolean
  source: KnowledgeSource
  confidence?: number | null
  commentVersions: CommentVersion[]
  keywords: KnowledgeKeyword[]
}

export interface PersonalKnowledge {
  personalWorkId: string
  malId: number | null
  versions: CommentVersion[]
  currentVersionNumber: number
  keywords: KnowledgeKeyword[]
  characters: CharacterKnowledge[]
  lastEnrichedAt: string | null
  storage: 'supabase' | 'local'
}

export interface PersonalKnowledgeSummary {
  personalWorkId: string
  currentComment: string
  keywords: string[]
  characters: string[]
  hasKnowledge: boolean
}

export interface AIResult<T> {
  available: boolean
  mode: 'remote-ai' | 'local-assist' | 'unavailable'
  data: T
  message?: string
}

const LOCAL_KEY = 'animefinder.personalKnowledge.v1'
const LEGACY_KEY = 'animefinder.aiEnrichment.v0'
const DRAFT_PREFIX = 'animefinder.personalKnowledge.draft.'
const AI_ENDPOINT = import.meta.env.VITE_AI_ENRICH_ENDPOINT as string | undefined

function id(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function readLocalRows(): Record<string, Omit<PersonalKnowledge, 'storage'>> {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as Record<string, Omit<PersonalKnowledge, 'storage'>> } catch { return {} }
}

function writeLocalRows(rows: Record<string, Omit<PersonalKnowledge, 'storage'>>) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(rows))
}

function stripStorage(profile: PersonalKnowledge): Omit<PersonalKnowledge, 'storage'> {
  const { storage: _storage, ...rest } = profile
  return rest
}

function normalizeProfile(profile: Omit<PersonalKnowledge, 'storage'>): Omit<PersonalKnowledge, 'storage'> {
  return {
    ...profile,
    keywords: (profile.keywords ?? []).map((keyword, index) => ({ ...keyword, rank: index + 1 })),
    characters: (profile.characters ?? []).map((character, index) => ({
      ...character,
      rank: Number(character.rank) || index + 1,
      keywords: (character.keywords ?? []).map((keyword, keywordIndex) => ({ ...keyword, rank: keywordIndex + 1 })),
    })).sort((a, b) => a.rank - b.rank).map((character, index) => ({ ...character, rank: index + 1 })),
  }
}

function saveLocal(profile: Omit<PersonalKnowledge, 'storage'>): PersonalKnowledge {
  const rows = readLocalRows()
  const normalized = normalizeProfile(profile)
  rows[profile.personalWorkId] = normalized
  writeLocalRows(rows)
  return { ...normalized, storage: 'local' }
}

export function hasLocalKnowledge(personalWorkId: string) {
  const current = readLocalRows()[personalWorkId]
  if (current && (current.versions?.length || current.keywords?.length || current.characters?.length)) return true
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '{}') as Record<string, { aiEnriched?: boolean }>
    return Boolean(legacy[personalWorkId]?.aiEnriched)
  } catch { return false }
}

export function readDraft(personalWorkId: string) {
  try { return localStorage.getItem(`${DRAFT_PREFIX}${personalWorkId}`) ?? '' } catch { return '' }
}

export function writeDraft(personalWorkId: string, value: string) {
  try {
    if (value.trim()) localStorage.setItem(`${DRAFT_PREFIX}${personalWorkId}`, value)
    else localStorage.removeItem(`${DRAFT_PREFIX}${personalWorkId}`)
  } catch { /* ignore storage quota/private mode */ }
}

export function clearDraft(personalWorkId: string) {
  try { localStorage.removeItem(`${DRAFT_PREFIX}${personalWorkId}`) } catch { /* noop */ }
}

function emptyProfile(personalWorkId: string, malId: number | null): PersonalKnowledge {
  return { personalWorkId, malId, versions: [], currentVersionNumber: 0, keywords: [], characters: [], lastEnrichedAt: null, storage: 'local' }
}

function migrateLegacy(personalWorkId: string, malId: number | null): PersonalKnowledge | null {
  try {
    const legacyRows = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '{}') as Record<string, any>
    const old = legacyRows[personalWorkId]
    if (!old) return null
    const versions: CommentVersion[] = old.comment?.trim() ? [{ id: id('v'), versionNumber: 1, content: old.comment.trim(), source: 'manual', createdAt: old.lastEnrichedAt ?? new Date().toISOString() }] : []
    const profile: Omit<PersonalKnowledge, 'storage'> = {
      personalWorkId,
      malId: old.malId ?? malId,
      versions,
      currentVersionNumber: versions.length ? 1 : 0,
      keywords: (old.keywords ?? []).map((row: any, index: number) => ({ label: row.name ?? row.keyword ?? '', rank: index + 1, source: row.source === 'manual' ? 'manual' : 'ai_suggested', confirmed: Boolean(row.confirmed) })).filter((row: KnowledgeKeyword) => row.label),
      characters: (old.characters ?? []).map((row: any, index: number) => ({ id: id('character'), name: row.name ?? row.character_name ?? '', rank: index + 1, confirmed: Boolean(row.confirmed), source: row.source === 'manual' ? 'manual' : 'ai_suggested', commentVersions: row.reason ? [{ id: id('cv'), versionNumber: 1, content: row.reason, source: 'manual', createdAt: old.lastEnrichedAt ?? new Date().toISOString() }] : [], keywords: [] })).filter((row: CharacterKnowledge) => row.name),
      lastEnrichedAt: old.lastEnrichedAt ?? null,
    }
    return saveLocal(profile)
  } catch { return null }
}

async function userId() {
  if (!isSupabaseConfigured || !supabase) return null
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  return data.user.id
}

function errorText(error: { code?: string; message?: string } | null | undefined) {
  return `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase()
}

function missingTable(error: { code?: string; message?: string } | null | undefined) {
  const text = errorText(error)
  return text.includes('42p01') || text.includes('pgrst205') || text.includes('personal_work_comment_versions')
}

function missingRankColumn(error: { code?: string; message?: string } | null | undefined) {
  const text = errorText(error)
  return text.includes('42703') || (text.includes('rank') && text.includes('column'))
}

async function loadCharacterRows(uid: string, personalWorkId?: string) {
  if (!supabase) return { data: [] as any[], error: null as any }
  let query = supabase.from('personal_work_characters').select('id,personal_work_id,character_name,rank,source,confirmed,confidence,created_at').eq('user_id', uid)
  if (personalWorkId) query = query.eq('personal_work_id', personalWorkId)
  let result = await query.order('rank').order('created_at')
  if (result.error && missingRankColumn(result.error)) {
    let fallbackQuery = supabase.from('personal_work_characters').select('id,personal_work_id,character_name,source,confirmed,confidence,created_at').eq('user_id', uid)
    if (personalWorkId) fallbackQuery = fallbackQuery.eq('personal_work_id', personalWorkId)
    result = await fallbackQuery.order('created_at') as typeof result
  }
  return result
}

export async function loadPersonalKnowledge(personalWorkId: string, malId: number | null, fallbackComment = ''): Promise<PersonalKnowledge> {
  const local = readLocalRows()[personalWorkId]
  let fallback = local ? { ...normalizeProfile(local), storage: 'local' as const } : migrateLegacy(personalWorkId, malId) ?? emptyProfile(personalWorkId, malId)
  if (!fallback.versions.length && fallbackComment.trim()) {
    fallback = appendWorkVersion(fallback, fallbackComment.trim(), 'manual')
    saveLocal(stripStorage(fallback))
  }
  const uid = await userId()
  if (!uid || !supabase) return fallback

  const [versionRes, keywordRes, characterRes, characterCommentRes, characterKeywordRes] = await Promise.all([
    supabase.from('personal_work_comment_versions').select('id,version_number,content,source,created_at').eq('user_id', uid).eq('personal_work_id', personalWorkId).order('version_number'),
    supabase.from('personal_work_keywords').select('keyword,rank,source,confirmed,confidence').eq('user_id', uid).eq('personal_work_id', personalWorkId).order('rank'),
    loadCharacterRows(uid, personalWorkId),
    supabase.from('personal_character_comments').select('character_id,version_number,content,source,created_at').eq('user_id', uid).eq('personal_work_id', personalWorkId).order('version_number'),
    supabase.from('personal_character_keywords').select('character_id,keyword,rank,source,confirmed,confidence').eq('user_id', uid).eq('personal_work_id', personalWorkId).order('rank'),
  ])
  if (versionRes.error) {
    if (!missingTable(versionRes.error)) console.warn('AnimeFinder Personal Knowledge: Supabase read failed; using local cache.', versionRes.error.message)
    return fallback
  }

  const commentsByCharacter = new Map<string, CommentVersion[]>()
  for (const row of characterCommentRes.data ?? []) {
    const key = String(row.character_id)
    const list = commentsByCharacter.get(key) ?? []
    list.push({ id: `${key}-${row.version_number}`, versionNumber: Number(row.version_number), content: row.content ?? '', source: row.source as VersionSource, createdAt: row.created_at })
    commentsByCharacter.set(key, list)
  }
  const keywordsByCharacter = new Map<string, KnowledgeKeyword[]>()
  for (const row of characterKeywordRes.data ?? []) {
    const key = String(row.character_id)
    const list = keywordsByCharacter.get(key) ?? []
    list.push({ label: row.keyword, rank: Number(row.rank), source: row.source === 'manual' ? 'manual' : 'ai_suggested', confirmed: Boolean(row.confirmed), confidence: row.confidence == null ? null : Number(row.confidence) })
    keywordsByCharacter.set(key, list)
  }

  const versions: CommentVersion[] = (versionRes.data ?? []).map((row) => ({ id: String(row.id), versionNumber: Number(row.version_number), content: row.content ?? '', source: row.source as VersionSource, createdAt: row.created_at }))
  const characters: CharacterKnowledge[] = (characterRes.data ?? []).map((row: any, index: number) => ({
    id: String(row.id),
    name: row.character_name,
    rank: Number(row.rank) || index + 1,
    source: row.source === 'manual' ? 'manual' : 'ai_suggested',
    confirmed: Boolean(row.confirmed),
    confidence: row.confidence == null ? null : Number(row.confidence),
    commentVersions: commentsByCharacter.get(String(row.id)) ?? [],
    keywords: keywordsByCharacter.get(String(row.id)) ?? [],
  })).sort((a, b) => a.rank - b.rank).map((row, index) => ({ ...row, rank: index + 1 }))

  const result: PersonalKnowledge = {
    personalWorkId,
    malId,
    versions,
    currentVersionNumber: versions.at(-1)?.versionNumber ?? 0,
    keywords: (keywordRes.data ?? []).map((row) => ({ label: row.keyword, rank: Number(row.rank), source: row.source === 'manual' ? 'manual' : 'ai_suggested', confirmed: Boolean(row.confirmed), confidence: row.confidence == null ? null : Number(row.confidence) })),
    characters,
    lastEnrichedAt: versions.at(-1)?.createdAt ?? fallback.lastEnrichedAt,
    storage: 'supabase',
  }
  saveLocal(stripStorage(result))
  return result
}

export function currentWorkVersion(profile: PersonalKnowledge) {
  return profile.versions.find((version) => version.versionNumber === profile.currentVersionNumber) ?? profile.versions.at(-1) ?? null
}

export function appendWorkVersion(profile: PersonalKnowledge, content: string, source: VersionSource): PersonalKnowledge {
  const nextNumber = (profile.versions.at(-1)?.versionNumber ?? 0) + 1
  const version: CommentVersion = { id: id('v'), versionNumber: nextNumber, content: content.trim(), source, createdAt: new Date().toISOString() }
  return { ...profile, versions: [...profile.versions, version], currentVersionNumber: nextNumber, lastEnrichedAt: version.createdAt }
}

export function appendCharacterVersion(profile: PersonalKnowledge, characterId: string, content: string, source: VersionSource): PersonalKnowledge {
  return { ...profile, characters: profile.characters.map((character) => {
    if (character.id !== characterId) return character
    const nextNumber = (character.commentVersions.at(-1)?.versionNumber ?? 0) + 1
    return { ...character, commentVersions: [...character.commentVersions, { id: id('cv'), versionNumber: nextNumber, content: content.trim(), source, createdAt: new Date().toISOString() }] }
  }) }
}

export async function savePersonalKnowledge(profile: PersonalKnowledge): Promise<PersonalKnowledge> {
  const normalized: PersonalKnowledge = {
    ...profile,
    keywords: profile.keywords.map((keyword, index) => ({ ...keyword, rank: index + 1 })),
    characters: profile.characters.map((character, index) => ({
      ...character,
      rank: index + 1,
      keywords: character.keywords.map((keyword, keywordIndex) => ({ ...keyword, rank: keywordIndex + 1 })),
    })),
    lastEnrichedAt: new Date().toISOString(),
  }
  const localSaved = saveLocal(stripStorage(normalized))
  const uid = await userId()
  if (!uid || !supabase) return localSaved
  const { error } = await supabase.rpc('save_personal_knowledge_v1', {
    p_work_id: normalized.personalWorkId,
    p_mal_id: normalized.malId,
    p_versions: normalized.versions,
    p_keywords: normalized.keywords,
    p_characters: normalized.characters,
  })
  if (error) {
    if (!missingTable(error)) console.warn('AnimeFinder Personal Knowledge: Supabase save failed; data kept locally.', error.message)
    return localSaved
  }
  return { ...normalized, storage: 'supabase' }
}

function summaryFromProfile(profile: Omit<PersonalKnowledge, 'storage'>): PersonalKnowledgeSummary {
  const versions = profile.versions ?? []
  const current = versions.find((row) => row.versionNumber === profile.currentVersionNumber) ?? versions.at(-1)
  const keywords = (profile.keywords ?? []).filter((row) => row.confirmed).sort((a, b) => a.rank - b.rank).map((row) => row.label)
  const characters = (profile.characters ?? []).filter((row) => row.confirmed).sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999)).map((row) => row.name)
  return {
    personalWorkId: profile.personalWorkId,
    currentComment: current?.content ?? '',
    keywords,
    characters,
    hasKnowledge: Boolean(current?.content || keywords.length || characters.length),
  }
}

export function getCachedPersonalKnowledgeSummaries(workIds?: string[]) {
  const allowed = workIds ? new Set(workIds) : null
  return new Map(Object.values(readLocalRows())
    .filter((profile) => !allowed || allowed.has(profile.personalWorkId))
    .map((profile) => [profile.personalWorkId, summaryFromProfile(normalizeProfile(profile))]))
}

export async function loadPersonalKnowledgeSummaries(workIds: string[]): Promise<Map<string, PersonalKnowledgeSummary>> {
  const result = getCachedPersonalKnowledgeSummaries(workIds)
  const uid = await userId()
  if (!uid || !supabase || workIds.length === 0) return result

  const [versionRes, keywordRes, characterRes] = await Promise.all([
    supabase.from('personal_work_comment_versions').select('personal_work_id,version_number,content').eq('user_id', uid).in('personal_work_id', workIds).order('version_number'),
    supabase.from('personal_work_keywords').select('personal_work_id,keyword,rank,confirmed').eq('user_id', uid).in('personal_work_id', workIds).eq('confirmed', true).order('rank'),
    loadCharacterRows(uid),
  ])
  if (versionRes.error || keywordRes.error || characterRes.error) return result

  const latest = new Map<string, { version: number; content: string }>()
  for (const row of versionRes.data ?? []) {
    const key = String(row.personal_work_id)
    const version = Number(row.version_number)
    if (!latest.has(key) || version >= latest.get(key)!.version) latest.set(key, { version, content: row.content ?? '' })
  }
  const keywords = new Map<string, Array<{ rank: number; label: string }>>()
  for (const row of keywordRes.data ?? []) {
    const key = String(row.personal_work_id)
    const rows = keywords.get(key) ?? []
    rows.push({ rank: Number(row.rank), label: row.keyword })
    keywords.set(key, rows)
  }
  const characters = new Map<string, Array<{ rank: number; name: string }>>()
  for (const row of characterRes.data ?? []) {
    if (!row.confirmed) continue
    const key = String(row.personal_work_id)
    if (!workIds.includes(key)) continue
    const rows = characters.get(key) ?? []
    rows.push({ rank: Number(row.rank) || rows.length + 1, name: row.character_name })
    characters.set(key, rows)
  }

  for (const workId of workIds) {
    const currentComment = latest.get(workId)?.content ?? result.get(workId)?.currentComment ?? ''
    const keywordLabels = (keywords.get(workId) ?? []).sort((a, b) => a.rank - b.rank).map((row) => row.label)
    const characterNames = (characters.get(workId) ?? []).sort((a, b) => a.rank - b.rank).map((row) => row.name)
    const existing = result.get(workId)
    result.set(workId, {
      personalWorkId: workId,
      currentComment,
      keywords: keywordLabels.length ? keywordLabels : existing?.keywords ?? [],
      characters: characterNames.length ? characterNames : existing?.characters ?? [],
      hasKnowledge: Boolean(currentComment || keywordLabels.length || characterNames.length || existing?.hasKnowledge),
    })
  }
  return result
}

async function remoteAction<T>(action: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T | null> {
  if (!AI_ENDPOINT) return null
  const response = await fetch(AI_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify({ action, ...payload }) })
  if (!response.ok) throw new Error(`AI request failed (${response.status})`)
  return response.json() as Promise<T>
}

const keywordRules: Array<{ label: string; terms: string[] }> = [
  { label: 'Strategy', terms: ['estrateg', 'strategy', 'planning'] },
  { label: 'Tactical Combat', terms: ['tátic', 'tatic', 'tactic'] },
  { label: 'Team Combat', terms: ['equipe', 'team', 'coopera', 'combate em equipe'] },
  { label: 'Balance', terms: ['balance', 'balanceado', 'equilíbrio', 'equilibrio'] },
  { label: 'Power System', terms: ['sistema de poder', 'power system', 'trigger', 'habilidade', 'poder'] },
  { label: 'Character Development', terms: ['desenvolvimento', 'evolução', 'evolucao', 'personagem', 'character development'] },
  { label: 'Creativity', terms: ['criativ', 'creative'] },
  { label: 'Worldbuilding', terms: ['worldbuilding', 'mundo', 'universo', 'lore'] },
  { label: 'Battles', terms: ['batalha', 'combate', 'luta', 'fight', 'battle'] },
]

function localKeywordSuggestions(text: string): KnowledgeKeyword[] {
  const lower = text.toLocaleLowerCase()
  return keywordRules.filter((rule) => rule.terms.some((term) => lower.includes(term))).slice(0, 10).map((rule, index) => ({ label: rule.label, rank: index + 1, source: 'ai_suggested', confirmed: false, confidence: null }))
}

function localCharacterSuggestions(text: string): CharacterKnowledge[] {
  const matches = text.match(/\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}'’-]{2,}(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}'’-]{2,}){0,2}\b/gu) ?? []
  const blocked = new Set(['Anime', 'Manga', 'Light Novel', 'World Trigger', 'My Anime'])
  const unique = Array.from(new Set(matches.map((value) => value.trim()).filter((value) => !blocked.has(value) && value.split(/\s+/).length <= 3))).slice(0, 8)
  return unique.map((name, index) => ({ id: id('character'), name, rank: index + 1, source: 'ai_suggested', confirmed: false, confidence: null, commentVersions: [], keywords: [] }))
}

export const AIService = {
  async organizeComment(comment: string, context: { workName: string; originalObservations?: string | null }, signal?: AbortSignal): Promise<AIResult<string>> {
    if (!AI_ENDPOINT) return { available: false, mode: 'unavailable', data: comment, message: 'Advanced organization requires a configured remote AI service.' }
    const result = await remoteAction<{ organizedComment?: string }>('organize_comment', { comment, work: context.workName, originalObservations: context.originalObservations ?? null, instruction: 'Organize grammar, punctuation, cohesion and paragraphs without inventing or changing any user opinion. Preserve the user language.' }, signal)
    const organized = result?.organizedComment?.trim()
    if (!organized) return { available: false, mode: 'unavailable', data: comment, message: 'The AI did not return a valid organized suggestion.' }
    return { available: true, mode: 'remote-ai', data: organized }
  },

  async extractKeywords(comment: string, context: { workName: string }, signal?: AbortSignal): Promise<AIResult<KnowledgeKeyword[]>> {
    if (AI_ENDPOINT) {
      const result = await remoteAction<{ keywords?: Array<{ label?: string; importanceSuggestion?: number; confidence?: number }> }>('extract_keywords', { comment, work: context.workName, instruction: 'Return only characteristics explicitly supported by the user comment. All keyword labels must be in English, even if the comment is written in Portuguese.' }, signal)
      if (Array.isArray(result?.keywords)) {
        const rows = result!.keywords!.filter((row) => row.label?.trim()).slice(0, 12).map((row, index) => ({ label: row.label!.trim(), rank: Number(row.importanceSuggestion) || index + 1, source: 'ai_suggested' as const, confirmed: false, confidence: typeof row.confidence === 'number' ? row.confidence : null })).sort((a, b) => a.rank - b.rank).map((row, index) => ({ ...row, rank: index + 1 }))
        return { available: true, mode: 'remote-ai', data: rows }
      }
    }
    return { available: true, mode: 'local-assist', data: localKeywordSuggestions(comment), message: 'Simple local suggestions are active. Confirm only the keywords that represent your opinion.' }
  },

  async extractCharacters(comment: string, context: { workName: string }, signal?: AbortSignal): Promise<AIResult<CharacterKnowledge[]>> {
    if (AI_ENDPOINT) {
      const result = await remoteAction<{ characters?: Array<{ mentionedName?: string; normalizedName?: string; confidence?: number }> }>('extract_characters', { comment, work: context.workName, instruction: 'Identify only character names actually mentioned. Normalize only with high confidence from this work context; otherwise keep the mentioned name.' }, signal)
      if (Array.isArray(result?.characters)) {
        const rows = result!.characters!.filter((row) => (row.normalizedName || row.mentionedName)?.trim()).slice(0, 10).map((row, index) => ({ id: id('character'), name: (row.normalizedName || row.mentionedName)!.trim(), rank: index + 1, source: 'ai_suggested' as const, confirmed: false, confidence: typeof row.confidence === 'number' ? row.confidence : null, commentVersions: [], keywords: [] }))
        return { available: true, mode: 'remote-ai', data: rows }
      }
    }
    return { available: true, mode: 'local-assist', data: localCharacterSuggestions(comment), message: 'Local name detection is active. Review and confirm every character manually.' }
  },

  async organizeCharacterComment(comment: string, characterName: string, workName: string, signal?: AbortSignal) {
    return this.organizeComment(comment, { workName: `${characterName} — ${workName}` }, signal)
  },

  async extractCharacterKeywords(comment: string, characterName: string, signal?: AbortSignal) {
    return this.extractKeywords(comment, { workName: characterName }, signal)
  },
}
