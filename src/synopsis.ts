import { animeProvider } from './providers'
import { translationService } from './TranslationService'
import { findManagedWorkByMalId } from './personalCatalogManager'
import { loadMasterDataSnapshot } from './masterData'
import { isSupabaseConfigured, supabase } from './supabase'

export interface SynopsisBundle {
  original:string|null; portuguese:string|null; source:'MyAnimeList catalogue'|'AniList fallback'|null; translationError?:string
  status?:SynopsisStatus; storage?:'supabase'|'local'|'memory'; fetchedAt?:string|null; translatedAt?:string|null
}
export type SynopsisStatus='complete'|'original_only'|'missing_source'|'failed'
export interface StoredSynopsisRecord extends SynopsisBundle { personalWorkId:string; malId:number|null; sourceLanguage:string|null; lastError?:string|null }
export interface SynopsisBackfillProgress { total:number; alreadyCached:number; processed:number; succeeded:number; missingSource:number; failed:number; currentWork?:string }
type SynopsisWorkRef={id:string;displayName:string;primaryMalId:number|null}
type AniListResponse={data?:{Media?:{description?:string|null}|null};errors?:Array<{message?:string}>}

const memoryByWork=new Map<string,StoredSynopsisRecord>()
const memoryByMal=new Map<number,StoredSynopsisRecord>()
const requestMemory=new Map<number,Promise<SynopsisBundle>>()

function cleanSynopsis(value?:string|null):string|null{
  if(!value)return null
  const withBreaks=value.replace(/<br\s*\/?\s*>/gi,'\n'), container=document.createElement('div'); container.innerHTML=withBreaks
  const cleaned=(container.textContent||container.innerText||'').replace(/\r/g,'').replace(/\n{3,}/g,'\n\n').replace(/[ \t]+\n/g,'\n').trim()
  if(!cleaned || /no synopsis information has been added/i.test(cleaned) || /no description available/i.test(cleaned))return null
  return cleaned
}
async function currentUserId(){
  if(!isSupabaseConfigured || !supabase) throw new Error('Supabase is not configured.')
  const {data,error}=await supabase.auth.getUser(); if(error || !data.user) throw new Error('Sign in before loading persisted synopsis data.')
  return data.user.id
}
function fromRemote(data:any):StoredSynopsisRecord{
  return {personalWorkId:data.personal_work_id,malId:data.mal_id==null?null:Number(data.mal_id),original:data.synopsis_original ?? null,portuguese:data.synopsis_pt_br ?? null,source:data.synopsis_source==='AniList fallback'?'AniList fallback':data.synopsis_source?'MyAnimeList catalogue':null,sourceLanguage:data.synopsis_source_language ?? null,status:(data.status ?? 'failed') as SynopsisStatus,lastError:data.last_error ?? null,translationError:data.status==='original_only'?data.last_error ?? undefined:undefined,fetchedAt:data.synopsis_fetched_at ?? data.updated_at ?? null,translatedAt:data.synopsis_translated_at ?? null,storage:'supabase'}
}
function remember(record:StoredSynopsisRecord){memoryByWork.set(record.personalWorkId,record);if(record.malId!=null)memoryByMal.set(record.malId,record);window.dispatchEvent(new CustomEvent('animefinder:synopsis-cache-updated',{detail:record}))}

async function loadRemote(workId:string):Promise<StoredSynopsisRecord|null>{
  const uid=await currentUserId(); const {data,error}=await supabase!.from('personal_work_synopsis').select('personal_work_id,mal_id,synopsis_original,synopsis_pt_br,synopsis_source,synopsis_source_language,status,last_error,synopsis_fetched_at,synopsis_translated_at,updated_at').eq('user_id',uid).eq('personal_work_id',workId).maybeSingle()
  if(error)throw new Error(`Synopsis Supabase read failed: ${error.message}`)
  if(!data)return null; const record=fromRemote(data);remember(record);return record
}
async function persist(record:StoredSynopsisRecord):Promise<StoredSynopsisRecord>{
  const uid=await currentUserId(); const {error}=await supabase!.from('personal_work_synopsis').upsert({user_id:uid,personal_work_id:record.personalWorkId,mal_id:record.malId,synopsis_original:record.original,synopsis_pt_br:record.portuguese,synopsis_source:record.source,synopsis_source_language:record.sourceLanguage,status:record.status,last_error:record.lastError ?? record.translationError ?? null,synopsis_fetched_at:record.fetchedAt ?? new Date().toISOString(),synopsis_translated_at:record.translatedAt ?? null,updated_at:new Date().toISOString()},{onConflict:'user_id,personal_work_id'})
  if(error)throw new Error(`Synopsis persistence failed: ${error.message}`)
  const verified=await loadRemote(record.personalWorkId); if(!verified)throw new Error('Synopsis read-back returned no row.')
  if(verified.original!==record.original || verified.portuguese!==record.portuguese || verified.status!==record.status)throw new Error('Synopsis read-back did not match written values.')
  return verified
}

async function fetchAniListSynopsis(malId:number):Promise<string|null>{
  const query=`query ($idMal: Int) { Media(idMal: $idMal, type: ANIME) { description(asHtml: false) } }`
  const response=await fetch('https://graphql.anilist.co',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({query,variables:{idMal:malId}})})
  if(!response.ok)return null; const payload=await response.json() as AniListResponse;return cleanSynopsis(payload.data?.Media?.description)
}
async function fetchOriginal(malId:number):Promise<{original:string|null;source:SynopsisBundle['source']}>{
  try{const anime=await animeProvider.getAnime(malId);const original=cleanSynopsis(anime.synopsis);if(original)return{original,source:'MyAnimeList catalogue'}}catch{}
  try{const original=await fetchAniListSynopsis(malId);if(original)return{original,source:'AniList fallback'}}catch{}
  return{original:null,source:null}
}

export async function loadStoredSynopsis(workId:string){return loadRemote(workId)}
export function getCachedSynopsisRecords(workIds?:string[]){const allowed=workIds?new Set(workIds):null;return new Map(Array.from(memoryByWork.values()).filter((row)=>!allowed||allowed.has(row.personalWorkId)).map((row)=>[row.personalWorkId,row]))}

export async function ensureSynopsisForWork(work:SynopsisWorkRef,force=false):Promise<StoredSynopsisRecord>{
  const existing=await loadRemote(work.id)
  if(!force && existing?.original && existing?.portuguese)return existing
  if(!force && existing?.status==='missing_source')return existing
  if(!work.primaryMalId)return persist({personalWorkId:work.id,malId:null,original:existing?.original ?? null,portuguese:existing?.portuguese ?? null,source:existing?.source ?? null,sourceLanguage:existing?.sourceLanguage ?? null,status:'missing_source',lastError:'No compatible MAL anime source is associated with this Personal Work.',fetchedAt:existing?.fetchedAt ?? new Date().toISOString(),translatedAt:existing?.translatedAt ?? null,storage:'supabase'})
  let original=!force?existing?.original ?? null:null, source=!force?existing?.source ?? null:null, fetchedAt=existing?.fetchedAt ?? null
  if(!original){const fetched=await fetchOriginal(work.primaryMalId);original=fetched.original;source=fetched.source;fetchedAt=new Date().toISOString()}
  if(!original)return persist({personalWorkId:work.id,malId:work.primaryMalId,original:null,portuguese:null,source:null,sourceLanguage:null,status:'missing_source',lastError:'No trusted synopsis source returned content.',fetchedAt:fetchedAt ?? new Date().toISOString(),translatedAt:null,storage:'supabase'})
  let portuguese=!force?existing?.portuguese ?? null:null, translationError:string|undefined, translatedAt=!force?existing?.translatedAt ?? null:null
  if(!portuguese){try{portuguese=await translationService.translate(original,'en','pt-BR');translatedAt=new Date().toISOString()}catch(error){translationError=error instanceof Error?error.message:'Automatic translation unavailable'}}
  return persist({personalWorkId:work.id,malId:work.primaryMalId,original,portuguese,source,sourceLanguage:'en',status:portuguese?'complete':'original_only',lastError:translationError ?? null,translationError,fetchedAt:fetchedAt ?? new Date().toISOString(),translatedAt,storage:'supabase'})
}

async function buildBundle(malId:number):Promise<SynopsisBundle>{
  const work=findManagedWorkByMalId(malId)
  if(work)return ensureSynopsisForWork(work)
  // Non-personal discovery/details may use provider memory, because there is no Personal Work to persist yet.
  const fetched=await fetchOriginal(malId);if(!fetched.original)return{original:null,portuguese:null,source:null,storage:'memory'}
  try{return{original:fetched.original,portuguese:await translationService.translate(fetched.original,'en','pt-BR'),source:fetched.source,storage:'memory'}}catch(error){return{original:fetched.original,portuguese:null,source:fetched.source,translationError:error instanceof Error?error.message:'Automatic translation unavailable',storage:'memory'}}
}
export function loadSynopsisBundle(malId:number):Promise<SynopsisBundle>{
  const existing=requestMemory.get(malId);if(existing)return existing
  const work=findManagedWorkByMalId(malId), cached=work?memoryByWork.get(work.id):memoryByMal.get(malId)
  if(cached){const immediate=Promise.resolve(cached);requestMemory.set(malId,immediate);return immediate}
  const pending=buildBundle(malId).catch((error)=>{requestMemory.delete(malId);throw error});requestMemory.set(malId,pending);return pending
}

export async function backfillPersonalCatalogSynopsis(onProgress?:(progress:SynopsisBackfillProgress)=>void,signal?:AbortSignal):Promise<SynopsisBackfillProgress>{
  const snapshot=await loadMasterDataSnapshot(), works=snapshot.works
  const alreadyCached=works.filter((work)=>work.synopsis.original && work.synopsis.ptBR).length
  const pending=works.filter((work)=>!(work.synopsis.original&&work.synopsis.ptBR)&&work.synopsis.status!=='missing_source')
  const progress:SynopsisBackfillProgress={total:works.length,alreadyCached,processed:0,succeeded:0,missingSource:works.filter((work)=>work.synopsis.status==='missing_source').length,failed:0}
  for(const work of pending){if(signal?.aborted)break;progress.currentWork=work.displayName;onProgress?.({...progress});try{const result=await ensureSynopsisForWork(work,false);if(result.status==='complete'||result.status==='original_only')progress.succeeded+=1;else if(result.status==='missing_source')progress.missingSource+=1;else progress.failed+=1}catch(error){progress.failed+=1;console.error('AnimeFinder synopsis backfill item failed.',{entity:work.id,error:error instanceof Error?error.message:String(error)})}progress.processed+=1;onProgress?.({...progress});await new Promise((resolve)=>window.setTimeout(resolve,700))}
  progress.currentWork=undefined;onProgress?.({...progress});return progress
}
