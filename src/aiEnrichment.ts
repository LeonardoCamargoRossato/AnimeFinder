import type { Anime, AnimeCharacterCredit } from './types'
import type { ManagedCatalogWork } from './personalCatalogManager'
import { isSupabaseConfigured, supabase } from './supabase'

export type EnrichmentSource = 'manual' | 'ai_suggested'
export type CharacterSentiment = 'favorite' | 'liked' | 'interesting' | 'disliked' | 'memorable'

export interface EnrichmentKeyword {
  name: string
  importance: number
  confirmed: boolean
  source: EnrichmentSource
}

export interface EnrichmentCharacter {
  characterId: number | null
  name: string
  imageUrl?: string | null
  role?: string | null
  sentiment: CharacterSentiment
  reason: string
  confirmed: boolean
  source: EnrichmentSource
}

export interface PersonalAnimeProfile {
  personalWorkId: string
  malId: number | null
  comment: string
  aiEnriched: boolean
  lastEnrichedAt: string | null
  keywords: EnrichmentKeyword[]
  characters: EnrichmentCharacter[]
  storage: 'supabase' | 'local'
}

export interface EnrichmentSuggestion {
  suggestedComment: string
  keywords: EnrichmentKeyword[]
  characters: EnrichmentCharacter[]
  mode: 'remote-ai' | 'local-assist'
}

const LOCAL_KEY = 'animefinder.aiEnrichment.v0'
const AI_ENDPOINT = import.meta.env.VITE_AI_ENRICH_ENDPOINT as string | undefined

function readLocal(): Record<string, Omit<PersonalAnimeProfile, 'storage'>> {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as Record<string, Omit<PersonalAnimeProfile, 'storage'>> } catch { return {} }
}

function writeLocal(rows: Record<string, Omit<PersonalAnimeProfile, 'storage'>>) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(rows))
}

export function hasLocalEnrichment(personalWorkId: string) {
  return Boolean(readLocal()[personalWorkId]?.aiEnriched)
}

function saveLocal(profile: Omit<PersonalAnimeProfile, 'storage'>): PersonalAnimeProfile {
  const rows = readLocal()
  rows[profile.personalWorkId] = profile
  writeLocal(rows)
  return { ...profile, storage: 'local' }
}

function missingTable(error: { code?: string; message?: string } | null) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase()
  return text.includes('42p01') || text.includes('pgrst205') || text.includes('personal_anime_profile')
}

async function currentUserId() {
  if (!isSupabaseConfigured || !supabase) return null
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  return data.user.id
}

export async function loadEnrichment(personalWorkId: string, malId: number | null): Promise<PersonalAnimeProfile> {
  const local = readLocal()[personalWorkId]
  const fallback: PersonalAnimeProfile = local
    ? { ...local, storage: 'local' }
    : { personalWorkId, malId, comment: '', aiEnriched: false, lastEnrichedAt: null, keywords: [], characters: [], storage: 'local' }

  const userId = await currentUserId()
  if (!userId || !supabase) return fallback

  const [{ data: profileData, error: profileError }, { data: keywordData }, { data: characterData }] = await Promise.all([
    supabase.from('personal_anime_profile').select('personal_work_id,mal_id,comment,ai_enriched,last_enriched_at').eq('user_id', userId).eq('personal_work_id', personalWorkId).maybeSingle(),
    supabase.from('personal_anime_keywords').select('keyword,rank,source,confirmed').eq('user_id', userId).eq('personal_work_id', personalWorkId).order('rank'),
    supabase.from('personal_anime_characters').select('character_id,character_name,image_url,role,sentiment,reason,source,confirmed').eq('user_id', userId).eq('personal_work_id', personalWorkId),
  ])

  if (profileError) {
    if (!missingTable(profileError)) console.warn('AnimeFinder AI enrichment: Supabase read failed, using local fallback.', profileError.message)
    return fallback
  }
  if (!profileData) return fallback

  const result: PersonalAnimeProfile = {
    personalWorkId,
    malId: profileData.mal_id == null ? malId : Number(profileData.mal_id),
    comment: profileData.comment ?? '',
    aiEnriched: Boolean(profileData.ai_enriched),
    lastEnrichedAt: profileData.last_enriched_at ?? null,
    keywords: (keywordData ?? []).map((row) => ({
      name: row.keyword,
      importance: Number(row.rank),
      source: row.source === 'manual' ? 'manual' : 'ai_suggested',
      confirmed: Boolean(row.confirmed),
    })),
    characters: (characterData ?? []).map((row) => ({
      characterId: row.character_id == null ? null : Number(row.character_id),
      name: row.character_name,
      imageUrl: row.image_url ?? null,
      role: row.role ?? null,
      sentiment: (row.sentiment ?? 'interesting') as CharacterSentiment,
      reason: row.reason ?? '',
      source: row.source === 'manual' ? 'manual' : 'ai_suggested',
      confirmed: Boolean(row.confirmed),
    })),
    storage: 'supabase',
  }
  saveLocal({ ...result, storage: undefined } as Omit<PersonalAnimeProfile, 'storage'>)
  return result
}

export async function saveEnrichment(profile: Omit<PersonalAnimeProfile, 'storage'>): Promise<PersonalAnimeProfile> {
  const normalized = {
    ...profile,
    aiEnriched: true,
    lastEnrichedAt: new Date().toISOString(),
    keywords: profile.keywords.map((keyword, index) => ({ ...keyword, importance: index + 1 })),
  }
  const localSaved = saveLocal(normalized)
  const userId = await currentUserId()
  if (!userId || !supabase) return localSaved

  const { error } = await supabase.rpc('save_ai_enrichment', {
    p_profile: {
      personal_work_id: normalized.personalWorkId,
      mal_id: normalized.malId,
      comment: normalized.comment,
      ai_enriched: true,
      last_enriched_at: normalized.lastEnrichedAt,
    },
    p_keywords: normalized.keywords.map((keyword) => ({ keyword: keyword.name, rank: keyword.importance, source: keyword.source, confirmed: keyword.confirmed })),
    p_characters: normalized.characters.map((character) => ({
      character_id: character.characterId,
      character_name: character.name,
      image_url: character.imageUrl ?? null,
      role: character.role ?? null,
      sentiment: character.sentiment,
      reason: character.reason,
      source: character.source,
      confirmed: character.confirmed,
    })),
  })

  if (error) {
    if (!missingTable(error)) console.warn('AnimeFinder AI enrichment: Supabase save failed; enrichment kept locally.', error.message)
    return localSaved
  }
  return { ...normalized, storage: 'supabase' }
}

function normalizeSentence(value: string) {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const capitalized = text.charAt(0).toUpperCase() + text.slice(1)
  return /[.!?…]$/.test(capitalized) ? capitalized : `${capitalized}.`
}

export function consolidateComment(currentComment: string, transcript: string) {
  const current = currentComment.trim()
  const addition = normalizeSentence(transcript)
  if (!current) return addition
  if (!addition) return current
  const comparableCurrent = current.toLocaleLowerCase()
  const comparableAddition = addition.toLocaleLowerCase()
  if (comparableCurrent.includes(comparableAddition.replace(/[.!?…]$/, ''))) return current
  return `${current.replace(/\s+$/g, '')}\n\n${addition}`
}

const keywordRules: Array<{ name: string; terms: string[] }> = [
  { name: 'Estratégia', terms: ['estrateg', 'strategy', 'strategic', 'planejamento', 'planning', 'tática', 'tactic'] },
  { name: 'Trabalho em equipe', terms: ['trabalho em equipe', 'equipe', 'teamwork', 'team work', 'coopera', 'cooperation'] },
  { name: 'Batalhas', terms: ['batalha', 'luta', 'combate', 'battle', 'fight', 'combat'] },
  { name: 'Desenvolvimento de personagens', terms: ['desenvolvimento de personagem', 'personagens', 'character development', 'characters'] },
  { name: 'Sistema de poder', terms: ['sistema de poder', 'poderes', 'power system', 'abilities', 'habilidades'] },
  { name: 'Worldbuilding', terms: ['worldbuilding', 'construção de mundo', 'mundo', 'universo', 'lore'] },
  { name: 'Protagonista inteligente', terms: ['inteligente', 'inteligência', 'smart protagonist', 'intelligent protagonist'] },
  { name: 'Mistério', terms: ['mistério', 'misterio', 'mystery', 'investiga'] },
  { name: 'Psicológico', terms: ['psicológico', 'psicologico', 'psychological', 'mente', 'mental'] },
  { name: 'Humor', terms: ['humor', 'comédia', 'comedia', 'funny', 'comedy'] },
  { name: 'Romance', terms: ['romance', 'romântico', 'romantico', 'relationship'] },
  { name: 'Animação', terms: ['animação', 'animacao', 'animation', 'visual', 'arte'] },
  { name: 'Trilha sonora', terms: ['trilha sonora', 'música', 'musica', 'soundtrack', 'music'] },
  { name: 'Ritmo', terms: ['ritmo', 'pacing', 'pace'] },
]

function localKeywords(comment: string): EnrichmentKeyword[] {
  const normalized = comment.toLocaleLowerCase()
  return keywordRules
    .filter((rule) => rule.terms.some((term) => normalized.includes(term)))
    .slice(0, 8)
    .map((rule, index) => ({ name: rule.name, importance: index + 1, confirmed: false, source: 'ai_suggested' as const }))
}

function localCharacters(comment: string, candidates: AnimeCharacterCredit[]): EnrichmentCharacter[] {
  const normalized = comment.toLocaleLowerCase()
  return candidates
    .filter((candidate) => {
      const full = candidate.character.name.toLocaleLowerCase()
      const parts = full.split(/\s+/).filter((part) => part.length >= 4)
      return normalized.includes(full) || parts.some((part) => normalized.includes(part))
    })
    .slice(0, 6)
    .map((candidate) => ({
      characterId: candidate.character.malId,
      name: candidate.character.name,
      imageUrl: candidate.character.imageUrl ?? null,
      role: candidate.role ?? null,
      sentiment: 'interesting' as const,
      reason: '',
      confirmed: false,
      source: 'ai_suggested' as const,
    }))
}

function validateSuggestion(value: unknown): EnrichmentSuggestion | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.suggestedComment !== 'string' || !Array.isArray(row.keywords) || !Array.isArray(row.characters)) return null
  const keywords: EnrichmentKeyword[] = row.keywords
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).name === 'string'))
    .slice(0, 10)
    .map((entry, index) => ({ name: String(entry.name), importance: index + 1, confirmed: false, source: 'ai_suggested' }))
  const characters: EnrichmentCharacter[] = row.characters
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).name === 'string'))
    .slice(0, 8)
    .map((entry) => ({
      characterId: typeof entry.characterId === 'number' ? entry.characterId : null,
      name: String(entry.name),
      sentiment: ['favorite', 'liked', 'interesting', 'disliked', 'memorable'].includes(String(entry.relation)) ? String(entry.relation) as CharacterSentiment : 'interesting',
      reason: typeof entry.reason === 'string' ? entry.reason : '',
      confirmed: false,
      source: 'ai_suggested',
    }))
  return { suggestedComment: row.suggestedComment, keywords, characters, mode: 'remote-ai' }
}

export async function suggestEnrichment({ work, anime, comment, originalObservations, characterCandidates = [], signal }: {
  work: ManagedCatalogWork
  anime?: Anime | null
  comment: string
  originalObservations?: string | null
  characterCandidates?: AnimeCharacterCredit[]
  signal?: AbortSignal
}): Promise<EnrichmentSuggestion> {
  if (AI_ENDPOINT) {
    try {
      const response = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          work: { id: work.id, displayName: work.displayName, malId: work.primaryMalId },
          comment,
          originalObservations: originalObservations || null,
          metadata: anime ? { title: anime.title, englishTitle: anime.titleEnglish, genres: anime.genres.map((genre) => genre.name), source: anime.source, studio: anime.studios?.map((studio) => studio.name) ?? [] } : null,
          characters: characterCandidates.slice(0, 30).map((candidate) => ({ id: candidate.character.malId, name: candidate.character.name, role: candidate.role })),
          instruction: 'Only organize information explicitly expressed by the user. Do not invent opinions. Return JSON with suggestedComment, keywords and characters.',
        }),
      })
      if (response.ok) {
        const parsed = validateSuggestion(await response.json())
        if (parsed) return parsed
      }
    } catch (error) {
      if (signal?.aborted) throw error
      console.warn('AnimeFinder AI enrichment: remote AI unavailable; using local assist.')
    }
  }

  return {
    suggestedComment: comment.trim(),
    keywords: localKeywords(comment),
    characters: localCharacters(comment, characterCandidates),
    mode: 'local-assist',
  }
}
