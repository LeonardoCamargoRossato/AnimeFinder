import { isSupabaseConfigured, supabase } from './supabase'

export type VersionSource = 'manual' | 'voice' | 'ai_organized' | 'restored'
export type KnowledgeSource = 'manual' | 'ai_suggested'

export interface CommentVersion { id: string; versionNumber: number; content: string; source: VersionSource; createdAt: string }
export interface KnowledgeKeyword { label: string; rank: number; source: KnowledgeSource; confirmed: boolean; confidence?: number | null }
export interface CharacterKnowledge {
  id: string; name: string; rank: number; confirmed: boolean; source: KnowledgeSource; confidence?: number | null
  commentVersions: CommentVersion[]; keywords: KnowledgeKeyword[]
}
export interface PersonalKnowledge {
  personalWorkId: string; malId: number | null; versions: CommentVersion[]; currentVersionNumber: number
  keywords: KnowledgeKeyword[]; characters: CharacterKnowledge[]; lastEnrichedAt: string | null; storage: 'supabase' | 'local'
}
export interface PersonalKnowledgeSummary { personalWorkId: string; currentComment: string; keywords: string[]; characters: string[]; hasKnowledge: boolean }
export interface AIResult<T> { available: boolean; mode: 'remote-ai' | 'local-assist' | 'unavailable'; data: T; message?: string }

const AI_ENDPOINT = import.meta.env.VITE_AI_ENRICH_ENDPOINT as string | undefined
const profileMemory = new Map<string, PersonalKnowledge>()
const summaryMemory = new Map<string, PersonalKnowledgeSummary>()
const draftMemory = new Map<string, string>()

function id(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function emptyProfile(personalWorkId: string, malId: number | null): PersonalKnowledge {
  return { personalWorkId, malId, versions: [], currentVersionNumber: 0, keywords: [], characters: [], lastEnrichedAt: null, storage: 'supabase' }
}

function normalizeProfile(profile: PersonalKnowledge): PersonalKnowledge {
  return {
    ...profile,
    storage: 'supabase',
    keywords: (profile.keywords ?? []).map((row, index) => ({ ...row, rank: index + 1 })),
    characters: (profile.characters ?? []).map((row, index) => ({
      ...row,
      rank: Number(row.rank) || index + 1,
      keywords: (row.keywords ?? []).map((keyword, keywordIndex) => ({ ...keyword, rank: keywordIndex + 1 })),
    })).sort((a, b) => a.rank - b.rank).map((row, index) => ({ ...row, rank: index + 1 })),
  }
}

async function userId() {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new Error('Sign in before using Personal Knowledge.')
  return data.user.id
}

async function loadCharacterRows(uid: string, personalWorkId?: string) {
  if (!supabase) return [] as any[]
  let query = supabase.from('personal_work_characters')
    .select('id,personal_work_id,character_name,rank,source,confirmed,confidence,created_at')
    .eq('user_id', uid)
  if (personalWorkId) query = query.eq('personal_work_id', personalWorkId)
  const { data, error } = await query.order('rank').order('created_at')
  if (error) throw new Error(`Could not load Personal Characters: ${error.message}`)
  return data ?? []
}

export function hasLocalKnowledge(personalWorkId: string) {
  return summaryMemory.get(personalWorkId)?.hasKnowledge ?? false
}

// Drafts are intentionally ephemeral memory. Reloading the browser discards unsaved text.
export function readDraft(personalWorkId: string) { return draftMemory.get(personalWorkId) ?? '' }
export function writeDraft(personalWorkId: string, value: string) { if (value.trim()) draftMemory.set(personalWorkId, value); else draftMemory.delete(personalWorkId) }
export function clearDraft(personalWorkId: string) { draftMemory.delete(personalWorkId) }

export async function loadPersonalKnowledge(personalWorkId: string, malId: number | null, fallbackComment = ''): Promise<PersonalKnowledge> {
  const uid = await userId()
  const [versionRes, keywordRes, characterRows, characterCommentRes, characterKeywordRes] = await Promise.all([
    supabase!.from('personal_work_comment_versions').select('id,version_number,content,source,created_at').eq('user_id', uid).eq('personal_work_id', personalWorkId).order('version_number'),
    supabase!.from('personal_work_keywords').select('keyword,rank,source,confirmed,confidence').eq('user_id', uid).eq('personal_work_id', personalWorkId).order('rank'),
    loadCharacterRows(uid, personalWorkId),
    supabase!.from('personal_character_comments').select('character_id,version_number,content,source,created_at').eq('user_id', uid).eq('personal_work_id', personalWorkId).order('version_number'),
    supabase!.from('personal_character_keywords').select('character_id,keyword,rank,source,confirmed,confidence').eq('user_id', uid).eq('personal_work_id', personalWorkId).order('rank'),
  ])
  const firstError = versionRes.error ?? keywordRes.error ?? characterCommentRes.error ?? characterKeywordRes.error
  if (firstError) throw new Error(`Personal Knowledge Supabase read failed: ${firstError.message}`)

  const commentsByCharacter = new Map<string, CommentVersion[]>()
  for (const row of characterCommentRes.data ?? []) {
    const key = String(row.character_id); const rows = commentsByCharacter.get(key) ?? []
    rows.push({ id: `${key}-${row.version_number}`, versionNumber: Number(row.version_number), content: row.content ?? '', source: row.source as VersionSource, createdAt: row.created_at })
    commentsByCharacter.set(key, rows)
  }
  const keywordsByCharacter = new Map<string, KnowledgeKeyword[]>()
  for (const row of characterKeywordRes.data ?? []) {
    const key = String(row.character_id); const rows = keywordsByCharacter.get(key) ?? []
    rows.push({ label: row.keyword, rank: Number(row.rank), source: row.source === 'manual' ? 'manual' : 'ai_suggested', confirmed: Boolean(row.confirmed), confidence: row.confidence == null ? null : Number(row.confidence) })
    keywordsByCharacter.set(key, rows)
  }

  let versions: CommentVersion[] = (versionRes.data ?? []).map((row) => ({ id: String(row.id), versionNumber: Number(row.version_number), content: row.content ?? '', source: row.source as VersionSource, createdAt: row.created_at }))
  // A Supabase comment may predate versioned Personal Knowledge. Use it in-memory as the initial edit basis; Save persists it properly.
  if (!versions.length && fallbackComment.trim()) versions = [{ id: id('v'), versionNumber: 1, content: fallbackComment.trim(), source: 'manual', createdAt: new Date().toISOString() }]

  const characters: CharacterKnowledge[] = characterRows.map((row: any, index: number) => ({
    id: String(row.id), name: row.character_name, rank: Number(row.rank) || index + 1,
    source: row.source === 'manual' ? 'manual' : 'ai_suggested', confirmed: Boolean(row.confirmed),
    confidence: row.confidence == null ? null : Number(row.confidence),
    commentVersions: commentsByCharacter.get(String(row.id)) ?? [], keywords: keywordsByCharacter.get(String(row.id)) ?? [],
  }))

  const result = normalizeProfile({
    personalWorkId, malId, versions, currentVersionNumber: versions.at(-1)?.versionNumber ?? 0,
    keywords: (keywordRes.data ?? []).map((row) => ({ label: row.keyword, rank: Number(row.rank), source: row.source === 'manual' ? 'manual' : 'ai_suggested', confirmed: Boolean(row.confirmed), confidence: row.confidence == null ? null : Number(row.confidence) })),
    characters, lastEnrichedAt: versions.at(-1)?.createdAt ?? null, storage: 'supabase',
  })
  profileMemory.set(personalWorkId, result)
  summaryMemory.set(personalWorkId, summaryFromProfile(result))
  return result
}

export function currentWorkVersion(profile: PersonalKnowledge) {
  return profile.versions.find((row) => row.versionNumber === profile.currentVersionNumber) ?? profile.versions.at(-1) ?? null
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
  await userId()
  const normalized = normalizeProfile({ ...profile, lastEnrichedAt: new Date().toISOString(), storage: 'supabase' })
  const { error } = await supabase!.rpc('save_personal_knowledge_v1', {
    p_work_id: normalized.personalWorkId,
    p_mal_id: normalized.malId,
    p_versions: normalized.versions,
    p_keywords: normalized.keywords,
    p_characters: normalized.characters,
  })
  if (error) throw new Error(`Personal Knowledge save failed: ${error.message}`)
  const verified = await loadPersonalKnowledge(normalized.personalWorkId, normalized.malId)
  profileMemory.set(verified.personalWorkId, verified)
  summaryMemory.set(verified.personalWorkId, summaryFromProfile(verified))
  window.dispatchEvent(new CustomEvent('animefinder:personal-knowledge-updated', { detail: { workId: verified.personalWorkId } }))
  return verified
}

function summaryFromProfile(profile: PersonalKnowledge): PersonalKnowledgeSummary {
  const current = currentWorkVersion(profile)
  const keywords = profile.keywords.filter((row) => row.confirmed).sort((a,b) => a.rank-b.rank).map((row) => row.label)
  const characters = profile.characters.filter((row) => row.confirmed).sort((a,b) => a.rank-b.rank).map((row) => row.name)
  return { personalWorkId: profile.personalWorkId, currentComment: current?.content ?? '', keywords, characters, hasKnowledge: Boolean(current?.content || keywords.length || characters.length) }
}

export function getCachedPersonalKnowledgeSummaries(workIds?: string[]) {
  const allowed = workIds ? new Set(workIds) : null
  return new Map(Array.from(summaryMemory.entries()).filter(([id]) => !allowed || allowed.has(id)))
}

export async function loadPersonalKnowledgeSummaries(workIds: string[]): Promise<Map<string, PersonalKnowledgeSummary>> {
  const result = new Map<string, PersonalKnowledgeSummary>()
  if (!workIds.length) return result
  const uid = await userId()
  const [versions, keywords, characters] = await Promise.all([
    supabase!.from('personal_work_comment_versions').select('personal_work_id,version_number,content').eq('user_id',uid).in('personal_work_id',workIds).order('version_number'),
    supabase!.from('personal_work_keywords').select('personal_work_id,keyword,rank,confirmed').eq('user_id',uid).in('personal_work_id',workIds).eq('confirmed',true).order('rank'),
    supabase!.from('personal_work_characters').select('personal_work_id,character_name,rank,confirmed').eq('user_id',uid).in('personal_work_id',workIds).eq('confirmed',true).order('rank'),
  ])
  const firstError = versions.error ?? keywords.error ?? characters.error
  if (firstError) throw new Error(`Personal Knowledge summary read failed: ${firstError.message}`)
  const latest = new Map<string,{version:number;content:string}>()
  for (const row of versions.data ?? []) { const id=String(row.personal_work_id); const v=Number(row.version_number); if (!latest.has(id) || v>=latest.get(id)!.version) latest.set(id,{version:v,content:row.content ?? ''}) }
  const keywordMap = new Map<string,Array<{rank:number;label:string}>>()
  for (const row of keywords.data ?? []) { const id=String(row.personal_work_id); const rows=keywordMap.get(id) ?? []; rows.push({rank:Number(row.rank),label:row.keyword}); keywordMap.set(id,rows) }
  const characterMap = new Map<string,Array<{rank:number;name:string}>>()
  for (const row of characters.data ?? []) { const id=String(row.personal_work_id); const rows=characterMap.get(id) ?? []; rows.push({rank:Number(row.rank),name:row.character_name}); characterMap.set(id,rows) }
  for (const workId of workIds) {
    const summary: PersonalKnowledgeSummary = {
      personalWorkId: workId,
      currentComment: latest.get(workId)?.content ?? '',
      keywords: (keywordMap.get(workId) ?? []).sort((a,b)=>a.rank-b.rank).map((row)=>row.label),
      characters: (characterMap.get(workId) ?? []).sort((a,b)=>a.rank-b.rank).map((row)=>row.name),
      hasKnowledge: Boolean(latest.get(workId)?.content || keywordMap.get(workId)?.length || characterMap.get(workId)?.length),
    }
    result.set(workId, summary); summaryMemory.set(workId, summary)
  }
  return result
}

async function remoteAction<T>(action: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T | null> {
  if (!AI_ENDPOINT) return null
  const response = await fetch(AI_ENDPOINT, { method:'POST', headers:{'Content-Type':'application/json'}, signal, body:JSON.stringify({action,...payload}) })
  if (!response.ok) throw new Error(`AI request failed (${response.status})`)
  return response.json() as Promise<T>
}

const keywordRules: Array<{label:string;terms:string[]}> = [
  { label:'Strategy', terms:['estrateg','strategy','planning'] },
  { label:'Tactical Combat', terms:['tátic','tatic','tactic'] },
  { label:'Team Combat', terms:['equipe','team','coopera','combate em equipe'] },
  { label:'Balance', terms:['balance','balanceado','equilíbrio','equilibrio'] },
  { label:'Power System', terms:['sistema de poder','power system','trigger','habilidade','poder'] },
  { label:'Character Development', terms:['desenvolvimento','evolução','evolucao','personagem','character development'] },
  { label:'Creativity', terms:['criativ','creative'] },
  { label:'Worldbuilding', terms:['worldbuilding','mundo','universo','lore'] },
  { label:'Battles', terms:['batalha','combate','luta','fight','battle'] },
]
function localKeywordSuggestions(text:string): KnowledgeKeyword[] { const lower=text.toLocaleLowerCase(); return keywordRules.filter((r)=>r.terms.some((t)=>lower.includes(t))).slice(0,10).map((r,i)=>({label:r.label,rank:i+1,source:'ai_suggested',confirmed:false,confidence:null})) }
function localCharacterSuggestions(text:string): CharacterKnowledge[] {
  const matches=text.match(/\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}'’-]{2,}(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}'’-]{2,}){0,2}\b/gu) ?? []
  const blocked=new Set(['Anime','Manga','Light Novel','World Trigger','My Anime'])
  const unique=Array.from(new Set(matches.map((v)=>v.trim()).filter((v)=>!blocked.has(v)&&v.split(/\s+/).length<=3))).slice(0,8)
  return unique.map((name,index)=>({id:id('character'),name,rank:index+1,source:'ai_suggested',confirmed:false,confidence:null,commentVersions:[],keywords:[]}))
}

export const AIService = {
  async organizeComment(comment:string, context:{workName:string;originalObservations?:string|null}, signal?:AbortSignal):Promise<AIResult<string>> {
    if (!AI_ENDPOINT) return {available:false,mode:'unavailable',data:comment,message:'Advanced organization requires a configured remote AI service.'}
    const result=await remoteAction<{organizedComment?:string}>('organize_comment',{comment,work:context.workName,originalObservations:context.originalObservations ?? null,instruction:'Organize grammar, punctuation, cohesion and paragraphs without inventing or changing any user opinion. Preserve the user language.'},signal)
    const organized=result?.organizedComment?.trim(); if(!organized) return {available:false,mode:'unavailable',data:comment,message:'The AI did not return a valid organized suggestion.'}
    return {available:true,mode:'remote-ai',data:organized}
  },
  async extractKeywords(comment:string, context:{workName:string}, signal?:AbortSignal):Promise<AIResult<KnowledgeKeyword[]>> {
    if (AI_ENDPOINT) { const result=await remoteAction<{keywords?:Array<{label?:string;importanceSuggestion?:number;confidence?:number}>}>('extract_keywords',{comment,work:context.workName,instruction:'Return only characteristics explicitly supported by the user comment. All keyword labels must be in English.'},signal); if(Array.isArray(result?.keywords)){const rows=result!.keywords!.filter((r)=>r.label?.trim()).slice(0,12).map((r,i)=>({label:r.label!.trim(),rank:Number(r.importanceSuggestion)||i+1,source:'ai_suggested' as const,confirmed:false,confidence:typeof r.confidence==='number'?r.confidence:null})).sort((a,b)=>a.rank-b.rank).map((r,i)=>({...r,rank:i+1})); return {available:true,mode:'remote-ai',data:rows}} }
    return {available:true,mode:'local-assist',data:localKeywordSuggestions(comment),message:'Simple local suggestions are active. Confirm only the keywords that represent your opinion.'}
  },
  async extractCharacters(comment:string, context:{workName:string}, signal?:AbortSignal):Promise<AIResult<CharacterKnowledge[]>> {
    if(AI_ENDPOINT){const result=await remoteAction<{characters?:Array<{mentionedName?:string;normalizedName?:string;confidence?:number}>}>('extract_characters',{comment,work:context.workName,instruction:'Identify only character names actually mentioned.'},signal); if(Array.isArray(result?.characters)){return {available:true,mode:'remote-ai',data:result!.characters!.filter((r)=>(r.normalizedName||r.mentionedName)?.trim()).slice(0,10).map((r,i)=>({id:id('character'),name:(r.normalizedName||r.mentionedName)!.trim(),rank:i+1,source:'ai_suggested',confirmed:false,confidence:typeof r.confidence==='number'?r.confidence:null,commentVersions:[],keywords:[]}))}}}
    return {available:true,mode:'local-assist',data:localCharacterSuggestions(comment),message:'Local name detection is active. Review and confirm every character manually.'}
  },
  async organizeCharacterComment(comment:string, characterName:string, workName:string, signal?:AbortSignal){ return this.organizeComment(comment,{workName:`${characterName} — ${workName}`},signal) },
  async extractCharacterKeywords(comment:string, characterName:string, signal?:AbortSignal){ return this.extractKeywords(comment,{workName:characterName},signal) },
}
