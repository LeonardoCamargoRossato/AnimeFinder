import type { Anime, WatchedAnime } from './types'
import { personalCatalogRepository, setRuntimePersonalCatalog, clearRuntimePersonalCatalog, type PersonalCatalogCategory, type PersonalCatalogItem } from './personalCatalog'
import { supabase } from './supabase'

export type PersonalWatchStatus = 'watched' | 'watching' | 'unfinished' | 'dropped' | 'planned' | 'unknown'

export interface ManagedCatalogWork extends PersonalCatalogItem {
  id: string
  displayName: string
  primaryMalId: number | null
  watchStatus: PersonalWatchStatus
  associationMalIds: number[]
  posterUrl?: string | null
  genres?: string[]
  pending?: boolean
  source: 'snapshot' | 'dynamic'
}

export interface ManagedCatalogState { dynamicWorks: ManagedCatalogWork[]; savedAt?: string }
let hydratedWorks: ManagedCatalogWork[] = []
let draftState: ManagedCatalogState | null = null
let hydrated = false

export function normalizePersonalWorkName(value: string) { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() }
function statusForCategory(category: PersonalCatalogCategory): PersonalWatchStatus {
  if (category === 'watched' || category === 'movies') return 'watched'
  if (category === 'dropped-unfinished') return 'unfinished'
  if (category === 'new-seasons-2026') return 'planned'
  return 'unknown'
}
function stableSnapshotId(item: PersonalCatalogItem, index: number) { return `snapshot:${item.category}:${item.malId ?? (normalizePersonalWorkName(item.anime) || index)}` }

/** Historical seed only: used by the verified one-time migration, never runtime rendering. */
export function legacySnapshotWorks(): ManagedCatalogWork[] {
  const result: ManagedCatalogWork[] = []; let index = 0
  for (const category of ['watched','movies','manhua','dropped-unfinished','new-seasons-2026','needs-classification'] as PersonalCatalogCategory[]) {
    for (const item of personalCatalogRepository.list(category)) result.push({ ...item, id: stableSnapshotId(item,index++), displayName:item.anime, primaryMalId:item.malId, watchStatus:statusForCategory(item.category), associationMalIds:item.malId==null?[]:[item.malId], genres:[], source:'snapshot' })
  }
  return result
}

function mapMasterRow(row:any):ManagedCatalogWork {
  return { id:String(row.id), displayName:String(row.displayName ?? ''), anime:String(row.displayName ?? ''), primaryMalId:row.primaryMalId==null?null:Number(row.primaryMalId), malId:row.primaryMalId==null?null:Number(row.primaryMalId), malUrl:row.malUrl ?? null, malScore:row.malScore==null?null:Number(row.malScore), originalObservations:row.originalObservations ?? null, comments:row.comment ?? null, englishName:row.englishName ?? null, originalName:row.originalName ?? null, myRanked:row.myRanked==null?null:Number(row.myRanked), watched:row.watchStatus==='watched', watchStatus:(row.watchStatus ?? 'unknown') as PersonalWatchStatus, category:row.category as PersonalCatalogCategory, associationMalIds:Array.isArray(row.associationMalIds)?row.associationMalIds.map(Number).filter(Number.isFinite):[], posterUrl:row.posterUrl ?? null, genres:Array.isArray(row.genres)?row.genres.map(String):[], pending:false, source:'dynamic' }
}
function publishRuntimeProjection(){ setRuntimePersonalCatalog(hydratedWorks.map(({ id: _id, displayName: _displayName, primaryMalId: _primaryMalId, watchStatus: _watchStatus, associationMalIds: _associationMalIds, posterUrl: _posterUrl, genres: _genres, pending: _pending, source: _source, ...item }) => ({ ...item }))) }

export async function hydrateManagedCatalog() {
  if (!supabase) throw new Error('Supabase is not configured.')
  const {data:userData,error:userError}=await supabase.auth.getUser()
  if(userError || !userData.user){hydratedWorks=[];hydrated=false;clearRuntimePersonalCatalog();return}
  const {data,error}=await supabase.rpc('get_master_data_snapshot')
  if(error)throw new Error(`Could not hydrate Personal Catalog from Supabase: ${error.message}`)
  const payload=(data ?? {}) as any; hydratedWorks=(Array.isArray(payload.works)?payload.works:[]).map(mapMasterRow);hydrated=true;publishRuntimeProjection()
  window.dispatchEvent(new CustomEvent('animefinder:catalog-hydrated',{detail:{count:hydratedWorks.length}}))
}

export function isManagedCatalogHydrated(){return hydrated}
export function readDynamicCatalogState():ManagedCatalogState{return{dynamicWorks:hydratedWorks.map((work)=>({...work})),savedAt:hydrated?new Date().toISOString():undefined}}
export function readDraftCatalogState():ManagedCatalogState|null{return draftState?{...draftState,dynamicWorks:draftState.dynamicWorks.map((work)=>({...work}))}:null}
export function writeDraftCatalogState(dynamicWorks:ManagedCatalogWork[]){draftState={dynamicWorks:dynamicWorks.map((work)=>({...work}))}}
export function clearDraftCatalogState(){draftState=null}
export function listManagedCatalogWorks(draft?:ManagedCatalogWork[]){return(draft ?? hydratedWorks).map((work)=>({...work}))}
export function listManagedCategory(category:PersonalCatalogCategory,draft?:ManagedCatalogWork[]){return listManagedCatalogWorks(draft).filter((work)=>work.category===category).sort((a,b)=>category==='watched'?(a.myRanked ?? Number.MAX_SAFE_INTEGER)-(b.myRanked ?? Number.MAX_SAFE_INTEGER):a.displayName.localeCompare(b.displayName))}

export function createManagedWorkFromAnime(anime:Anime,displayName:string,category:PersonalCatalogCategory,rank:number|null):ManagedCatalogWork{
  const id=typeof crypto!=='undefined'&&'randomUUID'in crypto?crypto.randomUUID():`work-${Date.now()}-${anime.malId}`
  return{id,displayName:displayName.trim()||anime.title,anime:displayName.trim()||anime.title,primaryMalId:anime.malId,malId:anime.malId,malUrl:anime.url ?? `https://myanimelist.net/anime/${anime.malId}`,malScore:anime.score ?? null,originalObservations:null,comments:null,englishName:anime.titleEnglish ?? null,originalName:anime.titleJapanese ?? null,myRanked:rank,watched:category==='watched'||category==='movies',watchStatus:statusForCategory(category),category,associationMalIds:[anime.malId],posterUrl:anime.imageUrl ?? anime.largeImageUrl ?? null,genres:anime.genres.map((genre)=>genre.name),pending:true,source:'dynamic'}
}
export function normalizeRanks(works:ManagedCatalogWork[]){return works.map((work,index)=>({...work,myRanked:index+1}))}
export function upsertDynamicWork(dynamicWorks:ManagedCatalogWork[],work:ManagedCatalogWork){const next=new Map(dynamicWorks.map((item)=>[item.id,item]));next.set(work.id,{...work,source:'dynamic'});return Array.from(next.values())}
export function captureCategoryOverrides(dynamicWorks:ManagedCatalogWork[],visibleWorks:ManagedCatalogWork[]){let next=dynamicWorks;for(const work of visibleWorks)next=upsertDynamicWork(next,{...work,source:'dynamic'});return next}
export function findManagedWorkByMalId(malId:number,draft?:ManagedCatalogWork[]){return listManagedCatalogWorks(draft).find((work)=>work.primaryMalId===malId||work.associationMalIds.includes(malId)) ?? null}
export function findPotentialDuplicate(anime:Anime,displayName:string,draft?:ManagedCatalogWork[]){const normalized=normalizePersonalWorkName(displayName);return listManagedCatalogWorks(draft).find((work)=>work.primaryMalId===anime.malId||work.associationMalIds.includes(anime.malId)||normalizePersonalWorkName(work.displayName)===normalized) ?? null}
export function getManagedWatchedMalIds(draft?:ManagedCatalogWork[]){const ids=new Set<number>();for(const work of listManagedCatalogWorks(draft)){if(work.watchStatus!=='watched')continue;if(work.primaryMalId!=null)ids.add(work.primaryMalId);work.associationMalIds.forEach((id)=>ids.add(id))}return ids}
export function isManagedMalIdWatched(malId:number){return getManagedWatchedMalIds().has(malId)}
export function managedWatchedRows():WatchedAnime[]{const rows:WatchedAnime[]=[];for(const work of listManagedCatalogWorks()){if(work.watchStatus!=='watched')continue;const ids=new Set(work.associationMalIds);if(work.primaryMalId!=null)ids.add(work.primaryMalId);ids.forEach((malId)=>rows.push({id:`managed-${work.id}-${malId}`,mal_id:malId,title_original:work.displayName,title_english:work.englishName,title_romaji:work.displayName,title_japanese:work.originalName,title_portuguese:null,title_chinese:null,match_status:'manually_confirmed'}))}return rows}

/** Temporary in-memory association used before Save; never browser-persisted. */
export function associateMalIdLocally(workId:string,malId:number){const source=hydratedWorks.find((work)=>work.id===workId);if(!source)return hydratedWorks;hydratedWorks=upsertDynamicWork(hydratedWorks,{...source,associationMalIds:Array.from(new Set([...source.associationMalIds,malId])),source:'dynamic'});publishRuntimeProjection();return listManagedCatalogWorks()}
function payloadFor(work:ManagedCatalogWork){return{id:work.id,display_name:work.displayName,primary_mal_id:work.primaryMalId,category:work.category,watch_status:work.watchStatus,my_ranked:work.myRanked,original_observations:work.originalObservations,comments:work.comments,poster_url:work.posterUrl ?? null,mal_score:work.malScore,english_name:work.englishName,original_name:work.originalName,mal_url:work.malUrl,association_mal_ids:work.associationMalIds}}
export async function saveManagedCatalog(dynamicWorks:ManagedCatalogWork[]):Promise<'supabase'>{
  if(!supabase)throw new Error('Supabase is not configured; Personal Catalog cannot be saved.')
  const {data:userData,error:userError}=await supabase.auth.getUser();if(userError||!userData.user)throw new Error('Sign in before saving the Personal Catalog.')
  const clean=dynamicWorks.map((work)=>({...work,pending:false,source:'dynamic' as const}));const {error}=await supabase.rpc('save_personal_catalog_batch',{p_works:clean.map(payloadFor)});if(error)throw new Error(`Personal Catalog save failed: ${error.message}`)
  hydratedWorks=clean;publishRuntimeProjection();clearDraftCatalogState();await hydrateManagedCatalog();return'supabase'
}
export async function associateExternalEntry(work:ManagedCatalogWork,malId:number):Promise<'supabase'>{const next=listManagedCatalogWorks().map((row)=>row.id===work.id?{...row,associationMalIds:Array.from(new Set([...row.associationMalIds,malId]))}:row);return saveManagedCatalog(next)}
export async function createAndSaveManagedWork(anime:Anime,displayName:string,category:PersonalCatalogCategory='watched'){const rank=category==='watched'?listManagedCategory('watched').length+1:null;const work=createManagedWorkFromAnime(anime,displayName,category,rank);const next=upsertDynamicWork(listManagedCatalogWorks(),work);await saveManagedCatalog(next);return work}
