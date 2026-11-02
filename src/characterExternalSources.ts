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
  verified?: boolean
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
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state)) } catch { /* best effort mirror */ }
  window.dispatchEvent(new CustomEvent('animefinder:character-external-sources-updated', { detail: changed ?? null }))
}

function notifyVerified(source: CharacterExternalSource) {
  if (source.provider === 'fandom' && source.confirmed && source.storage === 'supabase' && source.verified) {
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

function fromRemote(row: any): CharacterExternalSource {
  const metadata = (row.metadata_json ?? {}) as Record<string, unknown>
  return {
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
    verified: true,
  }
}

function replaceLocalScope(personalWorkId: string, personalCharacterId: string | undefined, rows: CharacterExternalSource[]) {
  const state = readLocal()
  for (const [entryKey, row] of Object.entries(state)) {
    if (row.personalWorkId !== personalWorkId) continue
    if (personalCharacterId && row.personalCharacterId !== personalCharacterId) continue
    delete state[entryKey]
  }
  for (const row of rows) state[key(row.personalWorkId, row.personalCharacterId, row.provider)] = row
  writeLocal(state)
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
    console.error('AnimeFinder external sources: Supabase read failed.', {
      operation: 'external_source_read',
      entity: personalCharacterId ?? personalWorkId,
      code: error.code,
      message: error.message,
      missingMigration: missingRelation(error),
    })
    return local
  }

  const remote = (data ?? []).map(fromRemote)
  replaceLocalScope(personalWorkId, personalCharacterId, remote)
  return remote
}

async function readBackSource(uid: string, source: Omit<CharacterExternalSource, 'updatedAt' | 'storage' | 'verified'>) {
  if (!supabase) return null
  const { data, error } = await supabase.from('personal_character_external_sources')
    .select('personal_work_id,personal_character_id,provider,external_id,canonical_name,url,image_url,metadata_json,confirmed,last_synced_at')
    .eq('user_id', uid)
    .eq('personal_work_id', source.personalWorkId)
    .eq('personal_character_id', source.personalCharacterId)
    .eq('provider', source.provider)
    .maybeSingle()
  if (error || !data) {
    console.error('AnimeFinder external source read-back failed.', {
      operation: 'external_source_read_back',
      entity: source.personalCharacterId,
      provider: source.provider,
      code: error?.code,
      message: error?.message,
    })
    return null
  }
  return fromRemote(data)
}

export async function saveExternalSource(source: Omit<CharacterExternalSource, 'updatedAt' | 'storage' | 'verified'>): Promise<CharacterExternalSource> {
  const timestamp = new Date().toISOString()
  const optimistic: CharacterExternalSource = { ...source, updatedAt: timestamp, storage: 'local', verified: false }
  const uid = await currentUserId()

  if (!uid || !supabase) {
    if (source.provider === 'fandom') {
      throw new Error('Fandom match was not saved because Supabase verification is unavailable. Sign in and run the V4 data-integrity migration.')
    }
    const state = readLocal()
    state[key(optimistic.personalWorkId, optimistic.personalCharacterId, optimistic.provider)] = optimistic
    writeLocal(state, optimistic)
    return optimistic
  }

  const { error } = await supabase.from('personal_character_external_sources').upsert({
    user_id: uid,
    personal_work_id: source.personalWorkId,
    personal_character_id: source.personalCharacterId,
    provider: source.provider,
    external_id: source.externalId,
    canonical_name: source.canonicalName,
    url: source.url ?? null,
    image_url: source.imageUrl ?? null,
    metadata_json: {
      ...(source.metadata ?? {}),
      description: source.description ?? null,
      wikiDomain: source.wikiDomain ?? null,
    },
    confirmed: source.confirmed,
    last_synced_at: timestamp,
  }, { onConflict: 'user_id,personal_work_id,personal_character_id,provider' })

  if (error) {
    console.error('AnimeFinder external source save failed.', {
      operation: 'external_source_write',
      entity: source.personalCharacterId,
      provider: source.provider,
      code: error.code,
      message: error.message,
      missingMigration: missingRelation(error),
    })
    if (source.provider === 'fandom') throw new Error(`Fandom persistence failed: ${error.message}`)
    const state = readLocal()
    state[key(optimistic.personalWorkId, optimistic.personalCharacterId, optimistic.provider)] = optimistic
    writeLocal(state, optimistic)
    return optimistic
  }

  const verified = await readBackSource(uid, source)
  const matches = verified
    && verified.provider === source.provider
    && verified.externalId === String(source.externalId)
    && verified.canonicalName === source.canonicalName
    && (verified.url ?? null) === (source.url ?? null)
    && (verified.imageUrl ?? null) === (source.imageUrl ?? null)
    && verified.confirmed === source.confirmed

  if (!matches) {
    if (source.provider === 'fandom') throw new Error('Fandom write completed but Supabase read-back verification failed. No success state was shown.')
    return optimistic
  }

  const state = readLocal()
  state[key(verified!.personalWorkId, verified!.personalCharacterId, verified!.provider)] = verified!
  writeLocal(state, verified!)
  notifyVerified(verified!)
  return verified!
}

export async function removeExternalSource(personalWorkId: string, personalCharacterId: string, provider: CharacterExternalProvider) {
  const uid = await currentUserId()
  if (uid && supabase) {
    const { error } = await supabase.from('personal_character_external_sources').delete()
      .eq('user_id', uid)
      .eq('personal_work_id', personalWorkId)
      .eq('personal_character_id', personalCharacterId)
      .eq('provider', provider)
    if (error) {
      console.error('AnimeFinder external sources: Supabase delete failed.', { operation: 'external_source_delete', entity: personalCharacterId, provider, code: error.code, message: error.message })
      throw new Error(error.message)
    }
  }
  const state = readLocal()
  delete state[key(personalWorkId, personalCharacterId, provider)]
  writeLocal(state)
}
