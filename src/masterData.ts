import { listAnimeComments, type AnimeComment } from './comments'
import {
  getCachedPersonalKnowledgeSummaries,
  loadPersonalKnowledgeSummaries,
  type PersonalKnowledgeSummary,
} from './aiPersonalKnowledge'
import { getCachedCharacterLinks } from './characterKnowledge'
import { getCachedExternalSources } from './characterExternalSources'
import { getCachedSynopsisRecords, type StoredSynopsisRecord } from './synopsis'
import { listManagedCatalogWorks, type ManagedCatalogWork } from './personalCatalogManager'
import { isSupabaseConfigured, supabase } from './supabase'

export interface MasterCharacterProjection {
  rank: number
  name: string
  personalComment: string
  keywords: string[]
  externalSources: {
    jikan?: { characterId: string; canonicalName: string; myAnimeListUrl?: string | null; imageUrl?: string | null }
    fandom?: { externalId: string; canonicalName: string; url?: string | null; wikiDomain?: string | null; imageUrl?: string | null }
  }
}

export interface MasterDataSnapshot {
  works: ManagedCatalogWork[]
  comments: Map<number, AnimeComment>
  summaries: Map<string, PersonalKnowledgeSummary>
  synopsis: Map<string, StoredSynopsisRecord>
  characterKnowledge: Map<string, MasterCharacterProjection[]>
}

type LocalProfile = {
  personalWorkId: string
  characters?: Array<{
    id: string
    name: string
    rank?: number
    confirmed?: boolean
    commentVersions?: Array<{ versionNumber?: number; content?: string }>
    keywords?: Array<{ label?: string; rank?: number; confirmed?: boolean }>
  }>
}

function chunk<T>(rows: T[], size = 45) {
  const result: T[][] = []
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size))
  return result
}

async function currentUserId() {
  if (!isSupabaseConfigured || !supabase) return null
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  return data.user.id
}

function readLocalProfiles(): Record<string, LocalProfile> {
  try { return JSON.parse(localStorage.getItem('animefinder.personalKnowledge.v1') ?? '{}') as Record<string, LocalProfile> } catch { return {} }
}

function localCharacterProjection(workId: string): MasterCharacterProjection[] {
  const profile = readLocalProfiles()[workId]
  if (!profile) return []
  const sources = getCachedExternalSources(workId)
  const legacy = getCachedCharacterLinks(workId)
  return (profile.characters ?? [])
    .filter((row) => row.confirmed)
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
    .map((row, index) => {
      const sourceRows = sources.filter((source) => source.personalCharacterId === row.id && source.confirmed)
      const jikanSource = sourceRows.find((source) => source.provider === 'jikan')
      const fandomSource = sourceRows.find((source) => source.provider === 'fandom')
      const legacyJikan = legacy.find((link) => link.personalCharacterId === row.id)
      const comment = [...(row.commentVersions ?? [])].sort((a, b) => (a.versionNumber ?? 0) - (b.versionNumber ?? 0)).at(-1)?.content ?? ''
      const keywords = (row.keywords ?? []).filter((item) => item.confirmed).sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999)).map((item) => item.label ?? '').filter(Boolean)
      const canonical = jikanSource?.canonicalName ?? legacyJikan?.canonicalName ?? fandomSource?.canonicalName ?? row.name
      return {
        rank: Number(row.rank) || index + 1,
        name: canonical,
        personalComment: comment,
        keywords,
        externalSources: {
          jikan: jikanSource || legacyJikan ? {
            characterId: jikanSource?.externalId ?? String(legacyJikan!.providerCharacterId),
            canonicalName: jikanSource?.canonicalName ?? legacyJikan!.canonicalName,
            myAnimeListUrl: jikanSource?.url ?? `https://myanimelist.net/character/${legacyJikan!.providerCharacterId}`,
            imageUrl: jikanSource?.imageUrl ?? legacyJikan?.imageUrl ?? null,
          } : undefined,
          fandom: fandomSource ? {
            externalId: fandomSource.externalId,
            canonicalName: fandomSource.canonicalName,
            url: fandomSource.url,
            wikiDomain: fandomSource.wikiDomain,
            imageUrl: fandomSource.imageUrl,
          } : undefined,
        },
      }
    })
}

async function loadSynopsisBatch(workIds: string[]) {
  const result = getCachedSynopsisRecords(workIds)
  const uid = await currentUserId()
  if (!uid || !supabase || !workIds.length) return result
  for (const ids of chunk(workIds)) {
    const { data, error } = await supabase.from('personal_work_synopsis')
      .select('personal_work_id,mal_id,synopsis_original,synopsis_pt_br,synopsis_source,synopsis_source_language,status,last_error,synopsis_fetched_at,updated_at')
      .eq('user_id', uid)
      .in('personal_work_id', ids)
    if (error) {
      console.error('AnimeFinder Master Data: synopsis batch read failed.', { code: error.code, message: error.message })
      break
    }
    for (const row of data ?? []) {
      result.set(row.personal_work_id, {
        personalWorkId: row.personal_work_id,
        malId: row.mal_id == null ? null : Number(row.mal_id),
        original: row.synopsis_original ?? null,
        portuguese: row.synopsis_pt_br ?? null,
        source: row.synopsis_source === 'AniList fallback' ? 'AniList fallback' : row.synopsis_source ? 'MyAnimeList catalogue' : null,
        sourceLanguage: row.synopsis_source_language ?? null,
        status: row.status,
        lastError: row.last_error ?? null,
        translationError: row.status === 'original_only' ? row.last_error ?? undefined : undefined,
        fetchedAt: row.synopsis_fetched_at ?? row.updated_at ?? null,
        storage: 'supabase',
      })
    }
  }
  return result
}

async function fetchRows(table: string, select: string, workIds: string[], uid: string) {
  const all: any[] = []
  if (!supabase) return all
  for (const ids of chunk(workIds)) {
    const { data, error } = await supabase.from(table).select(select).eq('user_id', uid).in('personal_work_id', ids)
    if (error) {
      console.error(`AnimeFinder Master Data: ${table} batch read failed.`, { code: error.code, message: error.message })
      return []
    }
    all.push(...(data ?? []))
  }
  return all
}

async function loadCharacterKnowledgeBatch(workIds: string[]) {
  const result = new Map<string, MasterCharacterProjection[]>()
  workIds.forEach((workId) => result.set(workId, localCharacterProjection(workId)))
  const uid = await currentUserId()
  if (!uid || !supabase || !workIds.length) return result

  const [characters, comments, keywords, sources, legacy] = await Promise.all([
    fetchRows('personal_work_characters', 'id,personal_work_id,character_name,rank,confirmed', workIds, uid),
    fetchRows('personal_character_comments', 'personal_work_id,character_id,version_number,content', workIds, uid),
    fetchRows('personal_character_keywords', 'personal_work_id,character_id,keyword,rank,confirmed', workIds, uid),
    fetchRows('personal_character_external_sources', 'personal_work_id,personal_character_id,provider,external_id,canonical_name,url,image_url,metadata_json,confirmed', workIds, uid),
    fetchRows('personal_character_external_links', 'personal_work_id,personal_character_id,provider_character_id,canonical_name,image_url', workIds, uid),
  ])
  if (!characters.length) return result

  const commentMap = new Map<string, any[]>()
  comments.forEach((row) => { const key = `${row.personal_work_id}::${row.character_id}`; const rows = commentMap.get(key) ?? []; rows.push(row); commentMap.set(key, rows) })
  const keywordMap = new Map<string, any[]>()
  keywords.forEach((row) => { const key = `${row.personal_work_id}::${row.character_id}`; const rows = keywordMap.get(key) ?? []; rows.push(row); keywordMap.set(key, rows) })
  const sourceMap = new Map<string, any[]>()
  sources.filter((row) => row.confirmed).forEach((row) => { const key = `${row.personal_work_id}::${row.personal_character_id}`; const rows = sourceMap.get(key) ?? []; rows.push(row); sourceMap.set(key, rows) })
  const legacyMap = new Map<string, any>()
  legacy.forEach((row) => legacyMap.set(`${row.personal_work_id}::${row.personal_character_id}`, row))

  for (const workId of workIds) {
    const rows = characters.filter((row) => row.personal_work_id === workId && row.confirmed)
      .sort((a, b) => (Number(a.rank) || 999) - (Number(b.rank) || 999))
      .map((row, index) => {
        const key = `${workId}::${row.id}`
        const latestComment = [...(commentMap.get(key) ?? [])].sort((a, b) => Number(a.version_number) - Number(b.version_number)).at(-1)?.content ?? ''
        const characterKeywords = (keywordMap.get(key) ?? []).filter((item) => item.confirmed).sort((a, b) => Number(a.rank) - Number(b.rank)).map((item) => item.keyword)
        const external = sourceMap.get(key) ?? []
        const jikan = external.find((item) => item.provider === 'jikan')
        const fandom = external.find((item) => item.provider === 'fandom')
        const old = legacyMap.get(key)
        const fandomMeta = (fandom?.metadata_json ?? {}) as Record<string, unknown>
        return {
          rank: Number(row.rank) || index + 1,
          name: jikan?.canonical_name ?? old?.canonical_name ?? fandom?.canonical_name ?? row.character_name,
          personalComment: latestComment,
          keywords: characterKeywords,
          externalSources: {
            jikan: jikan || old ? {
              characterId: String(jikan?.external_id ?? old?.provider_character_id),
              canonicalName: jikan?.canonical_name ?? old?.canonical_name,
              myAnimeListUrl: jikan?.url ?? `https://myanimelist.net/character/${old?.provider_character_id}`,
              imageUrl: jikan?.image_url ?? old?.image_url ?? null,
            } : undefined,
            fandom: fandom ? {
              externalId: String(fandom.external_id),
              canonicalName: fandom.canonical_name,
              url: fandom.url,
              wikiDomain: typeof fandomMeta.wikiDomain === 'string' ? fandomMeta.wikiDomain : null,
              imageUrl: fandom.image_url,
            } : undefined,
          },
        } satisfies MasterCharacterProjection
      })
    if (rows.length) result.set(workId, rows)
  }
  return result
}

export async function loadMasterDataSnapshot(): Promise<MasterDataSnapshot> {
  const works = listManagedCatalogWorks()
  const workIds = works.map((work) => work.id)
  const commentsPromise = listAnimeComments()
  const summariesPromise = loadPersonalKnowledgeSummaries(workIds)
  const synopsisPromise = loadSynopsisBatch(workIds)
  const charactersPromise = loadCharacterKnowledgeBatch(workIds)
  const [comments, summaries, synopsis, characterKnowledge] = await Promise.all([commentsPromise, summariesPromise, synopsisPromise, charactersPromise])
  return {
    works,
    comments: new Map(comments.map((row) => [row.malId, row])),
    summaries: summaries.size ? summaries : getCachedPersonalKnowledgeSummaries(workIds),
    synopsis,
    characterKnowledge,
  }
}

export function characterKnowledgeJson(snapshot: MasterDataSnapshot, workId: string) {
  return snapshot.characterKnowledge.get(workId) ?? []
}
