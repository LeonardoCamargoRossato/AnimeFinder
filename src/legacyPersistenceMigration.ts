import { legacySnapshotWorks, type ManagedCatalogWork } from './personalCatalogManager'
import { isSupabaseConfigured, supabase } from './supabase'

export interface LegacyMigrationReport {
  attempted: boolean
  complete: boolean
  catalogInserted: number
  commentsMigrated: number
  knowledgeMigrated: number
  synopsisMigrated: number
  externalSourcesMigrated: number
  clearedKeys: string[]
  errors: string[]
}

const CATALOG_KEY='animefinder.personalCatalog.dynamic.v0'
const COMMENTS_KEY='animefinder.personalComments.v1'
const KNOWLEDGE_KEY='animefinder.personalKnowledge.v1'
const ENRICHMENT_KEY='animefinder.aiEnrichment.v0'
const CHARACTER_KEY='animefinder.characterKnowledge.v1'
const EXTERNAL_KEY='animefinder.characterExternalSources.v2'
const SYNOPSIS_KEY='animefinder.synopsisCache.v3'

function parse<T>(key:string,fallback:T):T{try{return JSON.parse(localStorage.getItem(key) ?? '') as T}catch{return fallback}}
function catalogPayload(work:ManagedCatalogWork){return{id:work.id,display_name:work.displayName,primary_mal_id:work.primaryMalId,category:work.category,watch_status:work.watchStatus,my_ranked:work.myRanked,original_observations:work.originalObservations,comments:work.comments,poster_url:work.posterUrl ?? null,mal_score:work.malScore,english_name:work.englishName,original_name:work.originalName,mal_url:work.malUrl,association_mal_ids:work.associationMalIds}}

async function uid(){
  if(!isSupabaseConfigured || !supabase) return null
  const {data,error}=await supabase.auth.getUser(); if(error)return null;return data.user?.id ?? null
}

function clearVerified(key:string, report:LegacyMigrationReport){try{localStorage.removeItem(key);report.clearedKeys.push(key)}catch{}}

async function migrateCatalog(report:LegacyMigrationReport){
  const state=parse<{dynamicWorks?:ManagedCatalogWork[]}>(CATALOG_KEY,{})
  const merged=new Map(legacySnapshotWorks().map((work)=>[work.id,work]))
  for(const work of state.dynamicWorks ?? []) merged.set(work.id,work)
  const {data,error}=await supabase!.rpc('insert_missing_personal_catalog_works',{p_works:Array.from(merged.values()).map(catalogPayload)})
  if(error)throw new Error(`catalog: ${error.message}`)
  report.catalogInserted=Number(data)||0
  clearVerified(CATALOG_KEY,report)
}

async function migrateComments(userId:string,report:LegacyMigrationReport){
  const raw=parse<any>(COMMENTS_KEY,{})
  const rows=Array.isArray(raw)?raw:Object.values(raw ?? {})
  for(const item of rows){
    const malId=Number(item?.malId ?? item?.mal_id ?? item?.id)
    if(!Number.isFinite(malId))continue
    const {data:existing,error:readError}=await supabase!.from('anime_comments').select('mal_id').eq('user_id',userId).eq('mal_id',malId).maybeSingle()
    if(readError)throw new Error(`comments read: ${readError.message}`)
    if(existing)continue
    const {error}=await supabase!.from('anime_comments').insert({user_id:userId,mal_id:malId,content_html:item?.contentHtml ?? item?.content_html ?? '',content_text:item?.contentText ?? item?.content_text ?? '',updated_at:item?.updatedAt ?? item?.updated_at ?? new Date().toISOString()})
    if(error)throw new Error(`comments write: ${error.message}`)
    report.commentsMigrated+=1
  }
  clearVerified(COMMENTS_KEY,report)
}

function convertEnrichment(workId:string,old:any){
  const versions=old?.comment?.trim()?[{id:`legacy-${workId}-v1`,versionNumber:1,content:old.comment.trim(),source:'manual',createdAt:old.lastEnrichedAt ?? new Date().toISOString()}]:[]
  return {personalWorkId:workId,malId:old?.malId ?? null,versions,currentVersionNumber:versions.length?1:0,
    keywords:(old?.keywords ?? []).map((row:any,index:number)=>({label:row.name ?? row.keyword ?? '',rank:index+1,source:row.source==='manual'?'manual':'ai_suggested',confirmed:Boolean(row.confirmed)})).filter((row:any)=>row.label),
    characters:(old?.characters ?? []).map((row:any,index:number)=>({id:row.id ?? `legacy-character-${workId}-${index}`,name:row.name ?? row.character_name ?? '',rank:index+1,source:row.source==='manual'?'manual':'ai_suggested',confirmed:Boolean(row.confirmed),commentVersions:row.reason?[{id:`legacy-comment-${index}`,versionNumber:1,content:row.reason,source:'manual',createdAt:old.lastEnrichedAt ?? new Date().toISOString()}]:[],keywords:[]})).filter((row:any)=>row.name)}
}

async function migrateKnowledge(userId:string,report:LegacyMigrationReport){
  const current=parse<Record<string,any>>(KNOWLEDGE_KEY,{})
  const legacy=parse<Record<string,any>>(ENRICHMENT_KEY,{})
  const workIds=new Set([...Object.keys(current),...Object.keys(legacy)])
  for(const workId of workIds){
    const {data:existing,error:readError}=await supabase!.from('personal_work_comment_versions').select('id').eq('user_id',userId).eq('personal_work_id',workId).limit(1)
    if(readError)throw new Error(`knowledge read: ${readError.message}`)
    const {data:characters,error:characterRead}=await supabase!.from('personal_work_characters').select('id').eq('user_id',userId).eq('personal_work_id',workId).limit(1)
    if(characterRead)throw new Error(`knowledge characters read: ${characterRead.message}`)
    const {data:keywords,error:keywordRead}=await supabase!.from('personal_work_keywords').select('id').eq('user_id',userId).eq('personal_work_id',workId).limit(1)
    if(keywordRead)throw new Error(`knowledge keywords read: ${keywordRead.message}`)
    if((existing?.length ?? 0)||(characters?.length ?? 0)||(keywords?.length ?? 0))continue
    const profile=current[workId] ?? convertEnrichment(workId,legacy[workId])
    if(!profile)continue
    const {error}=await supabase!.rpc('save_personal_knowledge_v1',{p_work_id:workId,p_mal_id:profile.malId ?? null,p_versions:profile.versions ?? [],p_keywords:profile.keywords ?? [],p_characters:profile.characters ?? []})
    if(error)throw new Error(`knowledge write: ${error.message}`)
    report.knowledgeMigrated+=1
  }
  clearVerified(KNOWLEDGE_KEY,report);clearVerified(ENRICHMENT_KEY,report)
}

async function migrateSynopsis(userId:string,report:LegacyMigrationReport){
  const rows=parse<Record<string,any>>(SYNOPSIS_KEY,{})
  for(const [workId,row] of Object.entries(rows)){
    const {data:existing,error:readError}=await supabase!.from('personal_work_synopsis').select('personal_work_id').eq('user_id',userId).eq('personal_work_id',workId).maybeSingle()
    if(readError)throw new Error(`synopsis read: ${readError.message}`)
    if(existing)continue
    const {error}=await supabase!.from('personal_work_synopsis').insert({user_id:userId,personal_work_id:workId,mal_id:row.malId ?? null,synopsis_original:row.original ?? null,synopsis_pt_br:row.portuguese ?? null,synopsis_source:row.source ?? null,synopsis_source_language:row.sourceLanguage ?? null,status:row.status ?? (row.original?row.portuguese?'complete':'original_only':'failed'),last_error:row.lastError ?? row.translationError ?? null,synopsis_fetched_at:row.fetchedAt ?? null,synopsis_translated_at:row.translatedAt ?? null,updated_at:new Date().toISOString()})
    if(error)throw new Error(`synopsis write: ${error.message}`)
    report.synopsisMigrated+=1
  }
  clearVerified(SYNOPSIS_KEY,report)
}

async function upsertExternalIfMissing(userId:string,row:any){
  const workId=row.personalWorkId ?? row.personal_work_id, characterId=row.personalCharacterId ?? row.personal_character_id, provider=row.provider
  if(!workId||!characterId||!['jikan','fandom'].includes(provider))return false
  const {data:existing,error:readError}=await supabase!.from('personal_character_external_sources').select('provider').eq('user_id',userId).eq('personal_work_id',workId).eq('personal_character_id',characterId).eq('provider',provider).maybeSingle()
  if(readError)throw new Error(`external source read: ${readError.message}`);if(existing)return false
  const {error}=await supabase!.from('personal_character_external_sources').insert({user_id:userId,personal_work_id:workId,personal_character_id:characterId,provider,external_id:String(row.externalId ?? row.providerCharacterId ?? row.external_id ?? ''),canonical_name:row.canonicalName ?? row.canonical_name ?? '',url:row.url ?? (provider==='jikan'&&row.providerCharacterId?`https://myanimelist.net/character/${row.providerCharacterId}`:null),image_url:row.imageUrl ?? row.image_url ?? null,metadata_json:{...(row.metadata ?? {}),role:row.role ?? null,description:row.description ?? null,wikiDomain:row.wikiDomain ?? null,confidence:row.confidence ?? null,linkState:row.linkState ?? 'linked'},confirmed:row.confirmed !== false,last_synced_at:row.updatedAt ?? new Date().toISOString()})
  if(error)throw new Error(`external source write: ${error.message}`);return true
}

async function migrateExternalSources(userId:string,report:LegacyMigrationReport){
  const external=parse<Record<string,any>>(EXTERNAL_KEY,{})
  for(const row of Object.values(external))if(await upsertExternalIfMissing(userId,row))report.externalSourcesMigrated+=1
  const characterState=parse<any>(CHARACTER_KEY,{})
  for(const row of Object.values(characterState?.links ?? {}) as any[])if(await upsertExternalIfMissing(userId,{...row,provider:'jikan',confirmed:true}))report.externalSourcesMigrated+=1
  clearVerified(EXTERNAL_KEY,report);clearVerified(CHARACTER_KEY,report)
}

export async function migrateLegacyBrowserPersistence():Promise<LegacyMigrationReport>{
  const report:LegacyMigrationReport={attempted:false,complete:false,catalogInserted:0,commentsMigrated:0,knowledgeMigrated:0,synopsisMigrated:0,externalSourcesMigrated:0,clearedKeys:[],errors:[]}
  const userId=await uid();if(!userId || !supabase)return report
  report.attempted=true
  const steps=[()=>migrateCatalog(report),()=>migrateComments(userId,report),()=>migrateKnowledge(userId,report),()=>migrateSynopsis(userId,report),()=>migrateExternalSources(userId,report)]
  for(const step of steps){try{await step()}catch(error){report.errors.push(error instanceof Error?error.message:String(error))}}
  report.complete=report.errors.length===0
  if(report.complete) window.dispatchEvent(new CustomEvent('animefinder:legacy-migration-complete',{detail:report}))
  else console.warn('AnimeFinder legacy migration incomplete; browser data was retained for failed steps.',report)
  return report
}
