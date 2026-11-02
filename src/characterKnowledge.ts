import { characterProvider, type ExternalCharacterFull, type ExternalCharacterSummary } from './CharacterProvider'
import { isSupabaseConfigured, supabase } from './supabase'
import type { ManagedCatalogWork } from './personalCatalogManager'

export type CharacterLinkState = 'unlinked' | 'suggested_match' | 'linked' | 'manual'

export interface PersonalCharacterLink {
  personalWorkId: string
  personalCharacterId: string
  provider: 'jikan'
  providerCharacterId: number
  canonicalName: string
  imageUrl?: string | null
  role?: string | null
  linkState: CharacterLinkState
  confidence?: number | null
  updatedAt: string
}

export interface CharacterMatchSuggestion {
  personalCharacterId: string
  personalName: string
  candidate: ExternalCharacterSummary | null
  confidence: number
  reason: string
}

type CharacterCacheState = {
  rosters: Record<string, { fetchedAt: string; characters: ExternalCharacterSummary[] }>
  external: Record<string, ExternalCharacterFull | ExternalCharacterSummary>
  links: Record<string, PersonalCharacterLink>
}

const LOCAL_KEY = 'animefinder.characterKnowledge.v1'
const ROSTER_TTL_MS = 1000 * 60 * 60 * 24 * 30
const EXTERNAL_TTL_MS = 1000 * 60 * 60 * 24 * 14

function readLocal(): CharacterCacheState {
  try {
    const value = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as Partial<CharacterCacheState>
    return { rosters: value.rosters ?? {}, external: value.external ?? {}, links: value.links ?? {} }
  } catch {
    return { rosters: {}, external: {}, links: {} }
  }
}

function writeLocal(state: CharacterCacheState) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state)) } catch { /* storage can fail in private mode */ }
  window.dispatchEvent(new CustomEvent('animefinder:character-knowledge-updated'))
}

function linkKey(workId: string, characterId: string) { return `${workId}::${characterId}` }
function externalKey(providerCharacterId: number) { return `jikan::${providerCharacterId}` }

async function currentUserId() {
  if (!isSupabaseConfigured || !supabase) return null
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  return data.user.id
}

function missingRelation(error: { code?: string; message?: string } | null | undefined) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase()
  return text.includes('42p01') || text.includes('pgrst205')
    || text.includes('personal_character_external_links')
    || text.includes('external_characters')
    || text.includes('anime_character_roster_cache')
}

function normalize(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function romanizationLoose(value: string) {
  return normalize(value).replace(/ou/g, 'o').replace(/oo/g, 'o').replace(/uu/g, 'u')
}

function tokens(value: string) { return normalize(value).split(/\s+/).filter(Boolean) }

export function suggestCharacterMatch(personalCharacterId: string, personalName: string, candidates: ExternalCharacterSummary[]): CharacterMatchSuggestion {
  const exact = normalize(personalName)
  const loose = romanizationLoose(personalName)
  const personalTokens = tokens(personalName)
  let best: { candidate: ExternalCharacterSummary; confidence: number; reason: string } | null = null

  for (const candidate of candidates) {
    const candidateExact = normalize(candidate.canonicalName)
    const candidateLoose = romanizationLoose(candidate.canonicalName)
    const candidateTokens = tokens(candidate.canonicalName)
    let confidence = 0
    let reason = ''

    if (exact && exact === candidateExact) { confidence = .99; reason = 'Exact normalized name' }
    else if (loose && loose === candidateLoose) { confidence = .95; reason = 'Simple romanization variant' }
    else if (personalTokens.length >= 2 && [...personalTokens].reverse().join(' ') === candidateTokens.join(' ')) { confidence = .94; reason = 'Reversed name order' }
    else if (personalTokens.length === 1 && candidateTokens.includes(personalTokens[0])) { confidence = .79; reason = 'Single-name match inside this work roster' }
    else if (personalTokens.length >= 2 && personalTokens.every((token) => candidateTokens.includes(token))) { confidence = .89; reason = 'All personal name tokens matched' }

    if (!best || confidence > best.confidence) best = confidence ? { candidate, confidence, reason } : best
  }

  return {
    personalCharacterId,
    personalName,
    candidate: best?.candidate ?? null,
    confidence: best?.confidence ?? 0,
    reason: best?.reason ?? 'No reliable match inside this work roster',
  }
}

export function getCachedCharacterLinks(personalWorkId: string) {
  const state = readLocal()
  return Object.values(state.links).filter((row) => row.personalWorkId === personalWorkId)
}

export function getCachedCharacterLink(personalWorkId: string, personalCharacterId: string) {
  return readLocal().links[linkKey(personalWorkId, personalCharacterId)] ?? null
}

export function getCachedExternalCharacter(providerCharacterId: number) {
  return readLocal().external[externalKey(providerCharacterId)] ?? null
}

export async function loadCharacterLinks(personalWorkId: string): Promise<PersonalCharacterLink[]> {
  const local = getCachedCharacterLinks(personalWorkId)
  const uid = await currentUserId()
  if (!uid || !supabase) return local
  const { data, error } = await supabase.from('personal_character_external_links')
    .select('personal_work_id,personal_character_id,provider,provider_character_id,canonical_name,image_url,role,link_state,confidence,updated_at')
    .eq('user_id', uid).eq('personal_work_id', personalWorkId)
  if (error) {
    if (!missingRelation(error)) console.warn('AnimeFinder character links: Supabase read failed; using local cache.', error.message)
    return local
  }
  const state = readLocal()
  for (const row of data ?? []) {
    const link: PersonalCharacterLink = {
      personalWorkId: row.personal_work_id,
      personalCharacterId: row.personal_character_id,
      provider: 'jikan',
      providerCharacterId: Number(row.provider_character_id),
      canonicalName: row.canonical_name,
      imageUrl: row.image_url,
      role: row.role,
      linkState: row.link_state as CharacterLinkState,
      confidence: row.confidence == null ? null : Number(row.confidence),
      updatedAt: row.updated_at,
    }
    state.links[linkKey(link.personalWorkId, link.personalCharacterId)] = link
  }
  writeLocal(state)
  return Object.values(state.links).filter((row) => row.personalWorkId === personalWorkId)
}

export async function saveCharacterLink(link: Omit<PersonalCharacterLink, 'updatedAt'>): Promise<PersonalCharacterLink> {
  const saved: PersonalCharacterLink = { ...link, updatedAt: new Date().toISOString() }
  const state = readLocal()
  state.links[linkKey(saved.personalWorkId, saved.personalCharacterId)] = saved
  state.external[externalKey(saved.providerCharacterId)] = {
    provider: 'jikan', providerCharacterId: saved.providerCharacterId, canonicalName: saved.canonicalName,
    imageUrl: saved.imageUrl, role: saved.role,
  }
  writeLocal(state)

  const uid = await currentUserId()
  if (uid && supabase) {
    // Cache the external identity first. Personal data is never stored in this table.
    const { error: externalError } = await supabase.from('external_characters').upsert({
      provider: 'jikan',
      provider_character_id: saved.providerCharacterId,
      canonical_name: saved.canonicalName,
      image_url: saved.imageUrl ?? null,
      metadata_json: { role: saved.role ?? null },
      last_synced_at: saved.updatedAt,
    }, { onConflict: 'provider,provider_character_id' })
    if (externalError && !missingRelation(externalError)) console.warn('AnimeFinder external character identity cache failed.', externalError.message)

    const { error } = await supabase.from('personal_character_external_links').upsert({
      user_id: uid,
      personal_work_id: saved.personalWorkId,
      personal_character_id: saved.personalCharacterId,
      provider: saved.provider,
      provider_character_id: saved.providerCharacterId,
      canonical_name: saved.canonicalName,
      image_url: saved.imageUrl ?? null,
      role: saved.role ?? null,
      link_state: saved.linkState,
      confidence: saved.confidence ?? null,
      updated_at: saved.updatedAt,
    }, { onConflict: 'user_id,personal_work_id,personal_character_id' })
    if (error && !missingRelation(error)) console.warn('AnimeFinder character links: Supabase save failed; link kept locally.', error.message)
  }
  return saved
}

export async function unlinkCharacter(personalWorkId: string, personalCharacterId: string) {
  const state = readLocal()
  delete state.links[linkKey(personalWorkId, personalCharacterId)]
  writeLocal(state)
  const uid = await currentUserId()
  if (uid && supabase) {
    const { error } = await supabase.from('personal_character_external_links').delete().eq('user_id', uid).eq('personal_work_id', personalWorkId).eq('personal_character_id', personalCharacterId)
    if (error && !missingRelation(error)) console.warn('AnimeFinder character links: Supabase unlink failed.', error.message)
  }
}

async function loadRosterFromSupabase(animeMalId: number) {
  const uid = await currentUserId()
  if (!uid || !supabase) return null
  const { data, error } = await supabase.from('anime_character_roster_cache')
    .select('characters_json,last_synced_at')
    .eq('anime_mal_id', animeMalId)
    .maybeSingle()
  if (error) {
    if (!missingRelation(error)) console.warn('AnimeFinder roster cache read failed.', error.message)
    return null
  }
  if (!data) return null
  const age = Date.now() - new Date(data.last_synced_at).getTime()
  if (!Array.isArray(data.characters_json)) return null
  return { fresh: age < ROSTER_TTL_MS, fetchedAt: data.last_synced_at, characters: data.characters_json as ExternalCharacterSummary[] }
}

async function saveRosterToSupabase(animeMalId: number, characters: ExternalCharacterSummary[], fetchedAt: string) {
  const uid = await currentUserId()
  if (!uid || !supabase) return
  const { error } = await supabase.from('anime_character_roster_cache').upsert({
    anime_mal_id: animeMalId,
    characters_json: characters,
    last_synced_at: fetchedAt,
  }, { onConflict: 'anime_mal_id' })
  if (error && !missingRelation(error)) console.warn('AnimeFinder roster cache save failed.', error.message)
}

export async function loadAnimeCharacterRoster(animeMalId: number, force = false): Promise<ExternalCharacterSummary[]> {
  const state = readLocal()
  const cached = state.rosters[String(animeMalId)]
  const age = cached ? Date.now() - new Date(cached.fetchedAt).getTime() : Number.POSITIVE_INFINITY
  if (!force && cached && age < ROSTER_TTL_MS) return cached.characters

  if (!force) {
    const remoteCache = await loadRosterFromSupabase(animeMalId)
    if (remoteCache?.characters.length) {
      const next = readLocal()
      next.rosters[String(animeMalId)] = { fetchedAt: remoteCache.fetchedAt, characters: remoteCache.characters }
      for (const character of remoteCache.characters) next.external[externalKey(character.providerCharacterId)] = character
      writeLocal(next)
      if (remoteCache.fresh) return remoteCache.characters
    }
  }

  try {
    const characters = await characterProvider.getAnimeCharacters(animeMalId)
    const fetchedAt = new Date().toISOString()
    const next = readLocal()
    next.rosters[String(animeMalId)] = { fetchedAt, characters }
    for (const character of characters) next.external[externalKey(character.providerCharacterId)] = character
    writeLocal(next)
    void saveRosterToSupabase(animeMalId, characters, fetchedAt)
    return characters
  } catch (error) {
    // Stale cached metadata is still preferable to breaking Personal Knowledge when the provider is offline.
    const fallback = readLocal().rosters[String(animeMalId)] ?? cached
    if (fallback?.characters.length) return fallback.characters
    throw error
  }
}

function mergeRosterCharacter(current: ExternalCharacterSummary | undefined, incoming: ExternalCharacterSummary) {
  if (!current) return incoming
  const preferIncomingRole = current.role !== 'Main' && incoming.role === 'Main'
  return {
    ...current,
    ...incoming,
    role: preferIncomingRole ? incoming.role : current.role ?? incoming.role,
    imageUrl: current.imageUrl ?? incoming.imageUrl,
    voiceActors: current.voiceActors?.length ? current.voiceActors : incoming.voiceActors,
  }
}

export async function loadWorkCharacterRoster(work: ManagedCatalogWork, force = false): Promise<ExternalCharacterSummary[]> {
  const ids = Array.from(new Set([
    work.primaryMalId,
    ...work.associationMalIds,
    work.malId,
  ].filter((value): value is number => Number.isFinite(value))))
  if (!ids.length) throw new Error('This Personal Work does not have a MAL anime reference for character linking.')

  const settled = await Promise.allSettled(ids.map((id) => loadAnimeCharacterRoster(id, force)))
  const merged = new Map<number, ExternalCharacterSummary>()
  let firstError: unknown = null
  settled.forEach((result) => {
    if (result.status === 'rejected') { firstError ??= result.reason; return }
    result.value.forEach((character) => merged.set(character.providerCharacterId, mergeRosterCharacter(merged.get(character.providerCharacterId), character)))
  })
  if (!merged.size && firstError) throw firstError
  return Array.from(merged.values())
}

export async function loadExternalCharacter(providerCharacterId: number, force = false): Promise<ExternalCharacterFull> {
  const state = readLocal()
  const cached = state.external[externalKey(providerCharacterId)] as ExternalCharacterFull | undefined
  const fetchedAt = cached && 'fetchedAt' in cached ? cached.fetchedAt : null
  const fresh = fetchedAt && Date.now() - new Date(fetchedAt).getTime() < EXTERNAL_TTL_MS
  if (!force && cached && fresh && 'animeAppearances' in cached) return cached

  const uid = await currentUserId()
  if (!force && uid && supabase) {
    const { data, error } = await supabase.from('external_characters').select('provider_character_id,canonical_name,image_url,about,metadata_json,last_synced_at').eq('provider', 'jikan').eq('provider_character_id', providerCharacterId).maybeSingle()
    if (!error && data) {
      const metadata = (data.metadata_json ?? {}) as Record<string, unknown>
      const row: ExternalCharacterFull = {
        provider: 'jikan',
        providerCharacterId: Number(data.provider_character_id),
        canonicalName: data.canonical_name,
        imageUrl: data.image_url,
        about: data.about,
        role: (metadata.role as string | null | undefined) ?? null,
        url: (metadata.url as string | null | undefined) ?? `https://myanimelist.net/character/${providerCharacterId}`,
        favorites: (metadata.favorites as number | null | undefined) ?? null,
        alternativeNames: (metadata.alternativeNames as string[] | undefined) ?? [],
        animeAppearances: (metadata.animeAppearances as ExternalCharacterFull['animeAppearances'] | undefined) ?? [],
        mangaAppearances: (metadata.mangaAppearances as ExternalCharacterFull['mangaAppearances'] | undefined) ?? [],
        voiceActors: (metadata.voiceActors as ExternalCharacterFull['voiceActors'] | undefined) ?? [],
        fetchedAt: data.last_synced_at,
      }
      const next = readLocal(); next.external[externalKey(providerCharacterId)] = row; writeLocal(next)
      if (Date.now() - new Date(row.fetchedAt).getTime() < EXTERNAL_TTL_MS) return row
    } else if (error && !missingRelation(error)) console.warn('AnimeFinder external character cache read failed.', error.message)
  }

  try {
    const full = await characterProvider.getCharacter(providerCharacterId)
    const next = readLocal(); next.external[externalKey(providerCharacterId)] = full; writeLocal(next)
    if (uid && supabase) {
      const { error } = await supabase.from('external_characters').upsert({
        provider: 'jikan', provider_character_id: full.providerCharacterId, canonical_name: full.canonicalName,
        image_url: full.imageUrl ?? null, about: full.about ?? null,
        metadata_json: {
          role: full.role ?? null, url: full.url ?? null, favorites: full.favorites ?? null,
          alternativeNames: full.alternativeNames, animeAppearances: full.animeAppearances,
          mangaAppearances: full.mangaAppearances, voiceActors: full.voiceActors,
        }, last_synced_at: full.fetchedAt,
      }, { onConflict: 'provider,provider_character_id' })
      if (error && !missingRelation(error)) console.warn('AnimeFinder external character cache save failed.', error.message)
    }
    return full
  } catch (error) {
    if (cached && 'animeAppearances' in cached) return cached
    throw error
  }
}

export async function searchCharactersWithinWork(work: ManagedCatalogWork, query: string) {
  const roster = await loadWorkCharacterRoster(work)
  const term = normalize(query)
  if (!term) return roster
  return roster.filter((row) => normalize(row.canonicalName).includes(term))
}

export async function searchCharactersGlobally(query: string) {
  return characterProvider.searchCharacter(query)
}
