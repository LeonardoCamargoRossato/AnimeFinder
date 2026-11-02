import { characterProvider, type ExternalCharacterFull, type ExternalCharacterSummary } from './CharacterProvider'
import { isSupabaseConfigured, supabase } from './supabase'
import type { ManagedCatalogWork } from './personalCatalogManager'

export type CharacterLinkState = 'unlinked' | 'suggested_match' | 'linked' | 'manual'
export interface PersonalCharacterLink {
  personalWorkId: string; personalCharacterId: string; provider: 'jikan'; providerCharacterId: number; canonicalName: string
  imageUrl?: string | null; role?: string | null; linkState: CharacterLinkState; confidence?: number | null; updatedAt: string
}
export interface CharacterMatchSuggestion { personalCharacterId:string; personalName:string; candidate:ExternalCharacterSummary|null; confidence:number; reason:string }

const rosterMemory = new Map<number,{fetchedAt:string;characters:ExternalCharacterSummary[]}>()
const externalMemory = new Map<number,ExternalCharacterFull|ExternalCharacterSummary>()
const linkMemory = new Map<string,PersonalCharacterLink>()
const ROSTER_TTL_MS=1000*60*60*24*30
const EXTERNAL_TTL_MS=1000*60*60*24*14
const linkKey=(workId:string,characterId:string)=>`${workId}::${characterId}`

async function currentUserId(){
  if(!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.')
  const {data,error}=await supabase.auth.getUser(); if(error || !data.user) throw new Error('Sign in before using Character Knowledge.')
  return data.user.id
}
function normalize(value:string){ return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().replace(/[^a-z0-9]+/g,' ').trim() }
function romanizationLoose(value:string){ return normalize(value).replace(/ou/g,'o').replace(/oo/g,'o').replace(/uu/g,'u') }
function tokens(value:string){ return normalize(value).split(/\s+/).filter(Boolean) }

export function suggestCharacterMatch(personalCharacterId:string,personalName:string,candidates:ExternalCharacterSummary[]):CharacterMatchSuggestion{
  const exact=normalize(personalName), loose=romanizationLoose(personalName), personalTokens=tokens(personalName)
  let best:{candidate:ExternalCharacterSummary;confidence:number;reason:string}|null=null
  for(const candidate of candidates){
    const ce=normalize(candidate.canonicalName), cl=romanizationLoose(candidate.canonicalName), ct=tokens(candidate.canonicalName)
    let confidence=0, reason=''
    if(exact && exact===ce){confidence=.99;reason='Exact normalized name'}
    else if(loose && loose===cl){confidence=.95;reason='Simple romanization variant'}
    else if(personalTokens.length>=2 && [...personalTokens].reverse().join(' ')===ct.join(' ')){confidence=.94;reason='Reversed name order'}
    else if(personalTokens.length===1 && ct.includes(personalTokens[0])){confidence=.79;reason='Single-name match inside this work roster'}
    else if(personalTokens.length>=2 && personalTokens.every((token)=>ct.includes(token))){confidence=.89;reason='All personal name tokens matched'}
    if(confidence && (!best || confidence>best.confidence)) best={candidate,confidence,reason}
  }
  return {personalCharacterId,personalName,candidate:best?.candidate ?? null,confidence:best?.confidence ?? 0,reason:best?.reason ?? 'No reliable match inside this work roster'}
}

export function getCachedCharacterLinks(workId:string){ return Array.from(linkMemory.values()).filter((row)=>row.personalWorkId===workId) }
export function getCachedCharacterLink(workId:string,characterId:string){ return linkMemory.get(linkKey(workId,characterId)) ?? null }
export function getCachedExternalCharacter(id:number){ return externalMemory.get(id) ?? null }

export async function loadCharacterLinks(workId:string):Promise<PersonalCharacterLink[]>{
  const uid=await currentUserId()
  const {data,error}=await supabase!.from('personal_character_external_sources')
    .select('personal_work_id,personal_character_id,external_id,canonical_name,image_url,metadata_json,last_synced_at')
    .eq('user_id',uid).eq('personal_work_id',workId).eq('provider','jikan').eq('confirmed',true)
  if(error) throw new Error(`Jikan link read failed: ${error.message}`)
  for(const [key,row] of linkMemory.entries()) if(row.personalWorkId===workId) linkMemory.delete(key)
  for(const row of data ?? []){
    const meta=(row.metadata_json ?? {}) as Record<string,unknown>
    const link:PersonalCharacterLink={personalWorkId:row.personal_work_id,personalCharacterId:row.personal_character_id,provider:'jikan',providerCharacterId:Number(row.external_id),canonicalName:row.canonical_name,imageUrl:row.image_url,role:typeof meta.role==='string'?meta.role:null,linkState:(meta.linkState as CharacterLinkState) ?? 'linked',confidence:typeof meta.confidence==='number'?meta.confidence:null,updatedAt:row.last_synced_at}
    linkMemory.set(linkKey(link.personalWorkId,link.personalCharacterId),link)
  }
  return getCachedCharacterLinks(workId)
}

export async function saveCharacterLink(link:Omit<PersonalCharacterLink,'updatedAt'>):Promise<PersonalCharacterLink>{
  const uid=await currentUserId(), timestamp=new Date().toISOString()
  const {error:identityError}=await supabase!.from('external_characters').upsert({provider:'jikan',provider_character_id:link.providerCharacterId,canonical_name:link.canonicalName,image_url:link.imageUrl ?? null,metadata_json:{role:link.role ?? null},last_synced_at:timestamp},{onConflict:'provider,provider_character_id'})
  if(identityError) throw new Error(`Jikan identity persistence failed: ${identityError.message}`)
  const {error}=await supabase!.from('personal_character_external_sources').upsert({
    user_id:uid,personal_work_id:link.personalWorkId,personal_character_id:link.personalCharacterId,provider:'jikan',external_id:String(link.providerCharacterId),canonical_name:link.canonicalName,url:`https://myanimelist.net/character/${link.providerCharacterId}`,image_url:link.imageUrl ?? null,metadata_json:{role:link.role ?? null,linkState:link.linkState,confidence:link.confidence ?? null},confirmed:true,last_synced_at:timestamp,
  },{onConflict:'user_id,personal_work_id,personal_character_id,provider'})
  if(error) throw new Error(`Jikan link persistence failed: ${error.message}`)
  const rows=await loadCharacterLinks(link.personalWorkId)
  const verified=rows.find((row)=>row.personalCharacterId===link.personalCharacterId && row.providerCharacterId===link.providerCharacterId)
  if(!verified) throw new Error('Jikan link read-back verification failed.')
  window.dispatchEvent(new CustomEvent('animefinder:character-knowledge-updated'))
  return verified
}

export async function unlinkCharacter(workId:string,characterId:string){
  const uid=await currentUserId()
  const {error}=await supabase!.from('personal_character_external_sources').delete().eq('user_id',uid).eq('personal_work_id',workId).eq('personal_character_id',characterId).eq('provider','jikan')
  if(error) throw new Error(`Jikan unlink failed: ${error.message}`)
  linkMemory.delete(linkKey(workId,characterId)); window.dispatchEvent(new CustomEvent('animefinder:character-knowledge-updated'))
}

async function loadRosterFromSupabase(animeMalId:number){
  await currentUserId()
  const {data,error}=await supabase!.from('anime_character_roster_cache').select('characters_json,last_synced_at').eq('anime_mal_id',animeMalId).maybeSingle()
  if(error) throw new Error(`Character roster cache read failed: ${error.message}`)
  if(!data || !Array.isArray(data.characters_json)) return null
  return {fresh:Date.now()-new Date(data.last_synced_at).getTime()<ROSTER_TTL_MS,fetchedAt:data.last_synced_at,characters:data.characters_json as ExternalCharacterSummary[]}
}
async function saveRoster(animeMalId:number,characters:ExternalCharacterSummary[],fetchedAt:string){
  await currentUserId(); const {error}=await supabase!.from('anime_character_roster_cache').upsert({anime_mal_id:animeMalId,characters_json:characters,last_synced_at:fetchedAt},{onConflict:'anime_mal_id'}); if(error) throw new Error(error.message)
}

export async function loadAnimeCharacterRoster(animeMalId:number,force=false):Promise<ExternalCharacterSummary[]>{
  const mem=rosterMemory.get(animeMalId)
  if(!force && mem && Date.now()-new Date(mem.fetchedAt).getTime()<ROSTER_TTL_MS) return mem.characters
  let persisted:null|{fresh:boolean;fetchedAt:string;characters:ExternalCharacterSummary[]}=null
  if(!force){ persisted=await loadRosterFromSupabase(animeMalId); if(persisted){rosterMemory.set(animeMalId,persisted); persisted.characters.forEach((row)=>externalMemory.set(row.providerCharacterId,row)); if(persisted.fresh) return persisted.characters} }
  try{
    const characters=await characterProvider.getAnimeCharacters(animeMalId), fetchedAt=new Date().toISOString()
    await saveRoster(animeMalId,characters,fetchedAt); const verified=await loadRosterFromSupabase(animeMalId)
    if(!verified) throw new Error('Roster read-back failed.')
    rosterMemory.set(animeMalId,verified); verified.characters.forEach((row)=>externalMemory.set(row.providerCharacterId,row)); return verified.characters
  }catch(error){ if(persisted?.characters.length) return persisted.characters; throw error }
}

function mergeRosterCharacter(current:ExternalCharacterSummary|undefined,incoming:ExternalCharacterSummary){
  if(!current) return incoming
  const preferIncomingRole=current.role!=='Main' && incoming.role==='Main'
  return {...current,...incoming,role:preferIncomingRole?incoming.role:current.role ?? incoming.role,imageUrl:current.imageUrl ?? incoming.imageUrl,voiceActors:current.voiceActors?.length?current.voiceActors:incoming.voiceActors}
}

export async function loadWorkCharacterRoster(work:ManagedCatalogWork,force=false):Promise<ExternalCharacterSummary[]>{
  const ids=Array.from(new Set([work.primaryMalId,...work.associationMalIds,work.malId].filter((value):value is number=>Number.isFinite(value))))
  if(!ids.length) throw new Error('This Personal Work does not have a MAL anime reference for character linking.')
  const settled=await Promise.allSettled(ids.map((id)=>loadAnimeCharacterRoster(id,force))), merged=new Map<number,ExternalCharacterSummary>(); let firstError:unknown=null
  settled.forEach((result)=>{if(result.status==='rejected'){firstError ??= result.reason;return} result.value.forEach((row)=>merged.set(row.providerCharacterId,mergeRosterCharacter(merged.get(row.providerCharacterId),row)))})
  if(!merged.size && firstError) throw firstError
  return Array.from(merged.values())
}

function externalFromDb(row:any):ExternalCharacterFull{
  const metadata=(row.metadata_json ?? {}) as Record<string,unknown>
  return {provider:'jikan',providerCharacterId:Number(row.provider_character_id),canonicalName:row.canonical_name,imageUrl:row.image_url,about:row.about,role:(metadata.role as string|null|undefined) ?? null,url:(metadata.url as string|null|undefined) ?? `https://myanimelist.net/character/${row.provider_character_id}`,favorites:(metadata.favorites as number|null|undefined) ?? null,alternativeNames:(metadata.alternativeNames as string[]|undefined) ?? [],animeAppearances:(metadata.animeAppearances as ExternalCharacterFull['animeAppearances']|undefined) ?? [],mangaAppearances:(metadata.mangaAppearances as ExternalCharacterFull['mangaAppearances']|undefined) ?? [],voiceActors:(metadata.voiceActors as ExternalCharacterFull['voiceActors']|undefined) ?? [],fetchedAt:row.last_synced_at}
}

export async function loadExternalCharacter(id:number,force=false):Promise<ExternalCharacterFull>{
  const mem=externalMemory.get(id) as ExternalCharacterFull|undefined
  if(!force && mem?.fetchedAt && 'animeAppearances' in mem && Date.now()-new Date(mem.fetchedAt).getTime()<EXTERNAL_TTL_MS) return mem
  await currentUserId()
  let persisted:ExternalCharacterFull|null=null
  if(!force){const {data,error}=await supabase!.from('external_characters').select('provider_character_id,canonical_name,image_url,about,metadata_json,last_synced_at').eq('provider','jikan').eq('provider_character_id',id).maybeSingle(); if(error) throw new Error(`External character cache read failed: ${error.message}`); if(data){persisted=externalFromDb(data);externalMemory.set(id,persisted);if(Date.now()-new Date(persisted.fetchedAt).getTime()<EXTERNAL_TTL_MS)return persisted}}
  try{
    const full=await characterProvider.getCharacter(id)
    const {error}=await supabase!.from('external_characters').upsert({provider:'jikan',provider_character_id:full.providerCharacterId,canonical_name:full.canonicalName,image_url:full.imageUrl ?? null,about:full.about ?? null,metadata_json:{role:full.role ?? null,url:full.url ?? null,favorites:full.favorites ?? null,alternativeNames:full.alternativeNames,animeAppearances:full.animeAppearances,mangaAppearances:full.mangaAppearances,voiceActors:full.voiceActors},last_synced_at:full.fetchedAt},{onConflict:'provider,provider_character_id'})
    if(error) throw new Error(error.message)
    const {data,error:readError}=await supabase!.from('external_characters').select('provider_character_id,canonical_name,image_url,about,metadata_json,last_synced_at').eq('provider','jikan').eq('provider_character_id',id).single()
    if(readError) throw new Error(readError.message); const verified=externalFromDb(data); externalMemory.set(id,verified); return verified
  }catch(error){if(persisted)return persisted;throw error}
}

export async function searchCharactersWithinWork(work:ManagedCatalogWork,query:string){const roster=await loadWorkCharacterRoster(work);const term=normalize(query);return term?roster.filter((row)=>normalize(row.canonicalName).includes(term)):roster}
export async function searchCharactersGlobally(query:string){return characterProvider.searchCharacter(query)}
