import { isSupabaseConfigured, supabase } from './supabase'

export type CharacterExternalProvider = 'jikan' | 'fandom'

export interface CharacterExternalSource {
  personalWorkId: string
  personalCharacterId: string
  provider: CharacterExternalProvider
  externalId: string
  canonicalName: string
  url?: string | null
  imageUrl?: string | null
  description?: string | null
  wikiDomain?: string | null
  metadata?: Record<string, unknown>
  confirmed: boolean
  updatedAt: string
  storage?: 'supabase' | 'local'
}

type ExternalSourceState = Record<string, CharacterExternalSource>

const LOCAL_KEY = 'animefinder.characterExternalSources.v2'

function key(workId: string, characterId: string, provider: CharacterExternalProvider) {
  return `${workId}::${characterId}::${provider}`
}

function readLocal(): ExternalSourceState {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as ExternalSourceState } catch { return {} }
}

function writeLocal(state: ExternalSourceState, changed?: CharacterExternalSource) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state)) } catch { /* local cache best effort */ }
  window.dispatchEvent(new CustomEvent('animefinder:character-external-sources-updated', { detail: changed ?? null }))
}

function notifyConfirmed(source: CharacterExternalSource) {
  if (source.provider === 'fandom' && source.confirmed) {
    window.dispatchEvent(new CustomEvent('animefinder:fandom-match-confirmed', { detail: source }))
  }
}

async function currentUserId() {
  if (!isSupabaseConfigured || !supabase) return null
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  return data.user.id
}

function missingRelation(error: { code?: string; message?: string } | null | undefined) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase()
  return text.includes('42p01') || text.includes('pgrst205') || text.includes('personal_character_external_sources')
}

export function getCachedExternalSources(personalWorkId: string, personalCharacterId?: string) {
  return Object.values(readLocal()).filter((row) => row.personalWorkId === personalWorkId && (!personalCharacterId || row.personalCharacterId === personalCharacterId))
}

export function getCachedExternalSource(personalWorkId: string, personalCharacterId: string, provider: CharacterExternalProvider) {
  return readLocal()[key(personalWorkId, personalCharacterId, provider)] ?? null
}

export async function loadExternalSources(personalWorkId: string, personalCharacterId?: string): Promise<CharacterExternalSource[]> {
  const local = getCachedExternalSources(personalWorkId, personalCharacterId)
  const uid = await currentUserId()
  if (!uid || !supabase) return local

  let query = supabase.from('personal_character_external_sources')
    .select('personal_work_id,personal_character_id,provider,external_id,canonical_name,url,image_url,metadata_json,confirmed,last_synced_at')
    .eq('user_id', uid)
    .eq('personal_work_id', personalWorkId)
  if (personalCharacterId) query = query.eq('personal_character_id', personalCharacterId)
  const { data, error } = await query
  if (error) {
    console.error('AnimeFinder external sources: Supabase read failed; using local cache.', {
      code: error.code,
      message: error.message,
      missingMigration: missingRelation(error),
    })
    return local
  }

  const state = readLocal()
  for (const row of data ?? []) {
    const metadata = (row.metadata_json ?? {}) as Record<string, unknown>
    const source: CharacterExternalSource = {
      personalWorkId: row.personal_work_id,
      personalCharacterId: row.personal_character_id,
      provider: row.provider as CharacterExternalProvider,
      externalId: String(row.external_id),
      canonicalName: row.canonical_name,
      url: row.url,
      imageUrl: row.image_url,
      description: typeof metadata.description === 'string' ? metadata.description : null,
      wikiDomain: typeof metadata.wikiDomain === 'string' ? metadata.wikiDomain : null,
      metadata,
      confirmed: Boolean(row.confirmed),
      updatedAt: row.last_synced_at,
      storage: 'supabase',
    }
    state[key(source.personalWorkId, source.personalCharacterId, source.provider)] = source
  }
  writeLocal(state)
  return Object.values(state).filter((row) => row.personalWorkId === personalWorkId && (!personalCharacterId || row.personalCharacterId === personalCharacterId))
}

export async function saveExternalSource(source: Omit<CharacterExternalSource, 'updatedAt' | 'storage'>): Promise<CharacterExternalSource> {
  const timestamp = new Date().toISOString()
  let saved: CharacterExternalSource = { ...source, updatedAt: timestamp, storage: 'local' }
  const state = readLocal()
  state[key(saved.personalWorkId, saved.personalCharacterId, saved.provider)] = saved
  writeLocal(state, saved)

  const uid = await currentUserId()
  if (!uid || !supabase) {
    notifyConfirmed(saved)
    return saved
  }

  const { error } = await supabase.from('personal_character_external_sources').upsert({
    user_id: uid,
    personal_work_id: saved.personalWorkId,
    personal_character_id: saved.personalCharacterId,
    provider: saved.provider,
    external_id: saved.externalId,
    canonical_name: saved.canonicalName,
    url: saved.url ?? null,
    image_url: saved.imageUrl ?? null,
    metadata_json: {
      ...(saved.metadata ?? {}),
      description: saved.description ?? null,
      wikiDomain: saved.wikiDomain ?? null,
    },
    confirmed: saved.confirmed,
    last_synced_at: saved.updatedAt,
  }, { onConflict: 'user_id,personal_work_id,personal_character_id,provider' })

  if (error) {
    console.error('AnimeFinder external sources: Supabase save failed; source kept locally.', {
      provider: saved.provider,
      personalWorkId: saved.personalWorkId,
      personalCharacterId: saved.personalCharacterId,
      code: error.code,
      message: error.message,
      missingMigration: missingRelation(error),
    })
    notifyConfirmed(saved)
    return saved
  }

  saved = { ...saved, storage: 'supabase' }
  const next = readLocal()
  next[key(saved.personalWorkId, saved.personalCharacterId, saved.provider)] = saved
  writeLocal(next, saved)
  notifyConfirmed(saved)
  return saved
}

export async function removeExternalSource(personalWorkId: string, personalCharacterId: string, provider: CharacterExternalProvider) {
  const state = readLocal()
  delete state[key(personalWorkId, personalCharacterId, provider)]
  writeLocal(state)
  const uid = await currentUserId()
  if (uid && supabase) {
    const { error } = await supabase.from('personal_character_external_sources').delete()
      .eq('user_id', uid)
      .eq('personal_work_id', personalWorkId)
      .eq('personal_character_id', personalCharacterId)
      .eq('provider', provider)
    if (error) {
      console.error('AnimeFinder external sources: Supabase delete failed.', { code: error.code, message: error.message })
    }
  }
}
