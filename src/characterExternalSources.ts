import { isSupabaseConfigured, supabase } from './supabase'

export type CharacterExternalProvider = 'jikan' | 'fandom'
export interface CharacterExternalSource {
  personalWorkId: string; personalCharacterId: string; provider: CharacterExternalProvider; externalId: string
  canonicalName: string; url?: string | null; imageUrl?: string | null; description?: string | null; wikiDomain?: string | null
  metadata?: Record<string, unknown>; confirmed: boolean; updatedAt: string; storage?: 'supabase' | 'local'; verified?: boolean
}

const memory = new Map<string, CharacterExternalSource>()
function key(workId:string, characterId:string, provider:CharacterExternalProvider){ return `${workId}::${characterId}::${provider}` }

async function currentUserId(){
  if(!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.')
  const {data,error}=await supabase.auth.getUser(); if(error || !data.user) throw new Error('Sign in before loading character sources.')
  return data.user.id
}

function fromRemote(row:any):CharacterExternalSource{
  const metadata=(row.metadata_json ?? {}) as Record<string,unknown>
  return { personalWorkId:row.personal_work_id, personalCharacterId:row.personal_character_id, provider:row.provider as CharacterExternalProvider,
    externalId:String(row.external_id), canonicalName:row.canonical_name, url:row.url, imageUrl:row.image_url,
    description:typeof metadata.description==='string'?metadata.description:null, wikiDomain:typeof metadata.wikiDomain==='string'?metadata.wikiDomain:null,
    metadata, confirmed:Boolean(row.confirmed), updatedAt:row.last_synced_at, storage:'supabase', verified:true }
}

function replaceScope(workId:string, characterId:string|undefined, rows:CharacterExternalSource[]){
  for(const [k,row] of memory.entries()){ if(row.personalWorkId===workId && (!characterId || row.personalCharacterId===characterId)) memory.delete(k) }
  rows.forEach((row)=>memory.set(key(row.personalWorkId,row.personalCharacterId,row.provider),row))
  window.dispatchEvent(new CustomEvent('animefinder:character-external-sources-updated'))
}

export function getCachedExternalSources(workId:string, characterId?:string){ return Array.from(memory.values()).filter((row)=>row.personalWorkId===workId && (!characterId || row.personalCharacterId===characterId)) }
export function getCachedExternalSource(workId:string, characterId:string, provider:CharacterExternalProvider){ return memory.get(key(workId,characterId,provider)) ?? null }

export async function loadExternalSources(workId:string, characterId?:string):Promise<CharacterExternalSource[]>{
  const uid=await currentUserId()
  let query=supabase!.from('personal_character_external_sources').select('personal_work_id,personal_character_id,provider,external_id,canonical_name,url,image_url,metadata_json,confirmed,last_synced_at').eq('user_id',uid).eq('personal_work_id',workId)
  if(characterId) query=query.eq('personal_character_id',characterId)
  const {data,error}=await query
  if(error) throw new Error(`Character external source read failed: ${error.message}`)
  const rows=(data ?? []).map(fromRemote); replaceScope(workId,characterId,rows); return rows
}

async function readBack(uid:string, source:Omit<CharacterExternalSource,'updatedAt'|'storage'|'verified'>){
  const {data,error}=await supabase!.from('personal_character_external_sources')
    .select('personal_work_id,personal_character_id,provider,external_id,canonical_name,url,image_url,metadata_json,confirmed,last_synced_at')
    .eq('user_id',uid).eq('personal_work_id',source.personalWorkId).eq('personal_character_id',source.personalCharacterId).eq('provider',source.provider).maybeSingle()
  if(error || !data) throw new Error(`External source read-back failed: ${error?.message ?? 'row missing'}`)
  return fromRemote(data)
}

export async function saveExternalSource(source:Omit<CharacterExternalSource,'updatedAt'|'storage'|'verified'>):Promise<CharacterExternalSource>{
  const uid=await currentUserId(); const timestamp=new Date().toISOString()
  const {error}=await supabase!.from('personal_character_external_sources').upsert({
    user_id:uid, personal_work_id:source.personalWorkId, personal_character_id:source.personalCharacterId, provider:source.provider,
    external_id:source.externalId, canonical_name:source.canonicalName, url:source.url ?? null, image_url:source.imageUrl ?? null,
    metadata_json:{...(source.metadata ?? {}),description:source.description ?? null,wikiDomain:source.wikiDomain ?? null},
    confirmed:source.confirmed,last_synced_at:timestamp,
  },{onConflict:'user_id,personal_work_id,personal_character_id,provider'})
  if(error) throw new Error(`${source.provider === 'fandom' ? 'Fandom' : 'External source'} persistence failed: ${error.message}`)
  const verified=await readBack(uid,source)
  const matches=verified.provider===source.provider && verified.externalId===String(source.externalId) && verified.canonicalName===source.canonicalName
    && (verified.url ?? null)===(source.url ?? null) && (verified.imageUrl ?? null)===(source.imageUrl ?? null) && verified.confirmed===source.confirmed
  if(!matches) throw new Error(`${source.provider} write completed but Supabase read-back did not match.`)
  memory.set(key(verified.personalWorkId,verified.personalCharacterId,verified.provider),verified)
  window.dispatchEvent(new CustomEvent('animefinder:character-external-sources-updated',{detail:verified}))
  if(verified.provider==='fandom' && verified.confirmed) window.dispatchEvent(new CustomEvent('animefinder:fandom-match-confirmed',{detail:verified}))
  return verified
}

export async function removeExternalSource(workId:string, characterId:string, provider:CharacterExternalProvider){
  const uid=await currentUserId()
  const {error}=await supabase!.from('personal_character_external_sources').delete().eq('user_id',uid).eq('personal_work_id',workId).eq('personal_character_id',characterId).eq('provider',provider)
  if(error) throw new Error(`External source delete failed: ${error.message}`)
  memory.delete(key(workId,characterId,provider)); window.dispatchEvent(new CustomEvent('animefinder:character-external-sources-updated'))
}
