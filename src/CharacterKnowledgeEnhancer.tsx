import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  loadPersonalKnowledge,
  type CharacterKnowledge,
  type PersonalKnowledge,
} from './aiPersonalKnowledge'
import {
  getCachedCharacterLinks,
  getCachedExternalCharacter,
  loadCharacterLinks,
  loadExternalCharacter,
  loadWorkCharacterRoster,
  saveCharacterLink,
  searchCharactersGlobally,
  suggestCharacterMatch,
  unlinkCharacter,
  type CharacterMatchSuggestion,
  type PersonalCharacterLink,
} from './characterKnowledge'
import {
  isCharacterProviderUnavailableError,
  type ExternalCharacterFull,
  type ExternalCharacterSummary,
} from './CharacterProvider'
import { findManagedWorkByMalId, listManagedCatalogWorks, type ManagedCatalogWork } from './personalCatalogManager'

function CharacterImage({ src, name, className = '' }: { src?: string | null; name: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  return src && !failed
    ? <img className={className} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
    : <span className={`character-avatar-placeholder ${className}`}>{name.slice(0, 2).toUpperCase()}</span>
}

function CharacterProfileModal({ work, character, link, onClose }: {
  work: ManagedCatalogWork
  character: CharacterKnowledge
  link: PersonalCharacterLink
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [external, setExternal] = useState<ExternalCharacterFull | null>(() => {
    const cached = getCachedExternalCharacter(link.providerCharacterId)
    return cached && 'animeAppearances' in cached ? cached as ExternalCharacterFull : null
  })
  const [loading, setLoading] = useState(!external)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [aboutExpanded, setAboutExpanded] = useState(false)

  const loadExternal = useCallback(async (force = false) => {
    setLoading(true)
    setError('')
    try {
      const row = await loadExternalCharacter(link.providerCharacterId, force)
      setExternal(row)
    } catch (reason) {
      setError(isCharacterProviderUnavailableError(reason)
        ? 'Jikan temporarily unavailable. Cached Personal Knowledge is still available.'
        : reason instanceof Error ? reason.message : 'External character information is unavailable.')
    } finally {
      setLoading(false)
    }
  }, [link.providerCharacterId])

  useEffect(() => { void loadExternal(false) }, [loadExternal])

  const comment = character.commentVersions.at(-1)?.content ?? ''
  const keywords = character.keywords.filter((row) => row.confirmed).sort((a, b) => a.rank - b.rank)
  const cachedIdentity = getCachedExternalCharacter(link.providerCharacterId)
  const image = external?.imageUrl ?? cachedIdentity?.imageUrl ?? link.imageUrl
  const name = external?.canonicalName ?? cachedIdentity?.canonicalName ?? link.canonicalName ?? character.name
  const role = link.role ?? external?.role ?? cachedIdentity?.role
  const about = external?.about?.trim() ?? ''
  const malUrl = external?.url ?? cachedIdentity?.url ?? `https://myanimelist.net/character/${link.providerCharacterId}`

  return createPortal(<div className="character-modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
    <section className={expanded ? 'character-profile-modal expanded' : 'character-profile-modal'} role="dialog" aria-modal="true" aria-label={`${name} Character Profile`}>
      <header className="character-profile-header">
        <div><span className="eyebrow">CHARACTER PROFILE</span><h2>{name}</h2></div>
        <div className="character-profile-header-actions"><button className="ghost-button compact" type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? '🗗 Restore' : '⛶ Expand'}</button><button className="character-profile-close" type="button" onClick={onClose} aria-label="Close">×</button></div>
      </header>

      <div className="character-profile-identity">
        <CharacterImage src={image} name={name} className="character-profile-photo" />
        <div><span className="eyebrow">{work.displayName}</span><h3>{name}</h3>{role && <p>{role} Character</p>}<strong>#{character.rank} in My {work.displayName} Characters</strong></div>
      </div>

      <section className="character-profile-section personal-first">
        <div className="character-profile-section-heading"><span className="eyebrow">MY KNOWLEDGE</span><h3>What I think about this character</h3></div>
        <div className="character-profile-personal-grid">
          <article><span>MY RANK</span><strong>#{character.rank} in {work.displayName}</strong></article>
          <article className="character-profile-comment"><span>MY COMMENT</span><p>{comment || 'No personal comment yet.'}</p></article>
          <article><span>MY KEYWORDS</span>{keywords.length ? <div className="character-profile-keywords">{keywords.map((row) => <b key={row.label}>#{row.rank} {row.label}</b>)}</div> : <p>No confirmed character keywords yet.</p>}</article>
        </div>
      </section>

      <section className="character-profile-section external-section">
        <div className="character-profile-section-heading"><span className="eyebrow">CHARACTER INFORMATION</span><h3>Jikan / MyAnimeList</h3></div>
        {loading && <div className="character-external-loading"><span className="spinner" /><strong>Loading external character information…</strong></div>}
        {error && <div className="notice error character-provider-error"><strong>⚠ {error}</strong><small>Your Personal Knowledge is unaffected.</small><button className="ghost-button compact" type="button" onClick={() => void loadExternal(true)}>Retry</button></div>}
        {external && <>
          <div className="character-external-facts"><div><span>Canonical name</span><strong>{external.canonicalName}</strong></div>{role && <div><span>Role</span><strong>{role}</strong></div>}<div><span>MAL Character ID</span><strong>{external.providerCharacterId}</strong></div>{external.alternativeNames.length > 0 && <div><span>Alternative names</span><strong>{external.alternativeNames.join(' · ')}</strong></div>}</div>
          {about && <div className="character-about"><span>ABOUT</span><p className={aboutExpanded ? 'expanded' : ''}>{about}</p>{about.length > 420 && <button className="text-button" type="button" onClick={() => setAboutExpanded((value) => !value)}>{aboutExpanded ? 'Show less' : 'Show more'}</button>}</div>}
          {external.animeAppearances.length > 0 && <div className="character-appearances"><span>APPEARANCES</span><div>{external.animeAppearances.slice(0, aboutExpanded ? 30 : 10).map((appearance) => <button key={appearance.malId} type="button" onClick={() => { onClose(); navigate(`/app/anime/${appearance.malId}`) }}><strong>{appearance.title}</strong>{appearance.role && <small>{appearance.role}</small>}</button>)}</div></div>}
          {external.voiceActors.length > 0 && <div className="character-voice-actors"><span>VOICE ACTORS</span><div>{external.voiceActors.slice(0, 8).map((actor) => <div key={`${actor.malId}-${actor.language}`}><strong>{actor.name}</strong><small>{actor.language}</small></div>)}</div></div>}
        </>}
      </section>

      <footer className="character-profile-footer"><a className="ghost-button link-button" href={malUrl} target="_blank" rel="noreferrer">View on MyAnimeList ↗</a><button className="ghost-button" type="button" onClick={onClose}>Close</button></footer>
    </section>
  </div>, document.body)
}

function ManualCharacterSearch({ work, personalName, roster, onChoose, onClose }: {
  work: ManagedCatalogWork
  personalName: string
  roster: ExternalCharacterSummary[]
  onChoose: (row: ExternalCharacterSummary, manual: boolean) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState(personalName)
  const [globalResults, setGlobalResults] = useState<ExternalCharacterSummary[]>([])
  const [globalLoading, setGlobalLoading] = useState(false)
  const [globalError, setGlobalError] = useState('')
  const normalized = query.trim().toLocaleLowerCase()
  const localResults = roster.filter((row) => !normalized || row.canonicalName.toLocaleLowerCase().includes(normalized)).slice(0, 30)

  async function globalSearch() {
    if (!query.trim()) return
    setGlobalLoading(true); setGlobalError('')
    try { setGlobalResults(await searchCharactersGlobally(query)) }
    catch (reason) { setGlobalError(isCharacterProviderUnavailableError(reason) ? 'Jikan temporarily unavailable.' : 'Global character search failed.') }
    finally { setGlobalLoading(false) }
  }

  const resultList = globalResults.length ? globalResults : localResults
  const malIds = Array.from(new Set([work.primaryMalId, ...work.associationMalIds].filter((value): value is number => Number.isFinite(value))))
  return <div className="character-manual-search">
    <div className="character-manual-heading"><div><span className="eyebrow">SEARCH CHARACTER</span><strong>First searching within {work.displayName}</strong><small>MAL entries: {malIds.join(', ') || 'none'}</small></div><button type="button" onClick={onClose}>×</button></div>
    <div className="character-search-row"><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setGlobalResults([]); setGlobalError('') }} placeholder="Search character…" /><button className="ghost-button compact" disabled={globalLoading || !query.trim()} onClick={globalSearch}>{globalLoading ? 'Searching…' : 'Search Jikan globally'}</button></div>
    {globalError && <div className="notice error compact-notice">⚠ {globalError}</div>}
    <div className="character-search-results">{resultList.map((row) => <button type="button" key={row.providerCharacterId} onClick={() => onChoose(row, true)}><CharacterImage src={row.imageUrl} name={row.canonicalName} /><span><strong>{row.canonicalName}</strong><small>{row.role ?? (globalResults.length ? 'Global Jikan result' : 'Personal Work roster')}</small></span></button>)}{!resultList.length && <div className="character-search-empty">No matching character in the cached work roster. Use global search only if needed.</div>}</div>
  </div>
}

function LinkCharactersModal({ work, profile, onClose, onChanged, focusCharacterId }: {
  work: ManagedCatalogWork
  profile: PersonalKnowledge
  onClose: () => void
  onChanged: () => void
  focusCharacterId?: string | null
}) {
  const personalCharacters = profile.characters.filter((row) => row.confirmed).sort((a, b) => a.rank - b.rank)
  const [roster, setRoster] = useState<ExternalCharacterSummary[]>([])
  const [links, setLinks] = useState<PersonalCharacterLink[]>(() => getCachedCharacterLinks(work.id))
  const [suggestions, setSuggestions] = useState<Map<string, CharacterMatchSuggestion>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [providerUnavailable, setProviderUnavailable] = useState(false)
  const [manualId, setManualId] = useState<string | null>(focusCharacterId ?? null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const loadRoster = useCallback(async (force = false) => {
    setLoading(true); setError(''); setProviderUnavailable(false)
    try {
      const [characters, storedLinks] = await Promise.all([
        loadWorkCharacterRoster(work, force),
        loadCharacterLinks(work.id),
      ])
      setRoster(characters); setLinks(storedLinks)
      setSuggestions(new Map(personalCharacters.map((character) => [character.id, suggestCharacterMatch(character.id, character.name, characters)])))
    } catch (reason) {
      // Links are independent from the provider and should still hydrate when external metadata fails.
      setLinks(await loadCharacterLinks(work.id))
      const unavailable = isCharacterProviderUnavailableError(reason)
      setProviderUnavailable(unavailable)
      setError(unavailable
        ? 'Jikan temporarily unavailable. Cached characters remain usable; retry when the provider responds.'
        : reason instanceof Error ? reason.message : 'Could not load the Personal Work character roster.')
    } finally {
      setLoading(false)
    }
  }, [work, personalCharacters])

  useEffect(() => { void loadRoster(false) }, [loadRoster])

  const linkMap = useMemo(() => new Map(links.map((row) => [row.personalCharacterId, row])), [links])

  async function confirm(character: CharacterKnowledge, candidate: ExternalCharacterSummary, manual = false, confidence?: number) {
    setSavingId(character.id)
    try {
      const saved = await saveCharacterLink({
        personalWorkId: work.id,
        personalCharacterId: character.id,
        provider: 'jikan',
        providerCharacterId: candidate.providerCharacterId,
        canonicalName: candidate.canonicalName,
        imageUrl: candidate.imageUrl,
        role: candidate.role,
        linkState: manual ? 'manual' : 'linked',
        confidence: confidence ?? (manual ? 1 : null),
      })
      setLinks((current) => [...current.filter((row) => row.personalCharacterId !== character.id), saved])
      setManualId(null); onChanged()
    } finally { setSavingId(null) }
  }

  async function removeLink(characterId: string) {
    setSavingId(characterId)
    try { await unlinkCharacter(work.id, characterId); setLinks((current) => current.filter((row) => row.personalCharacterId !== characterId)); onChanged() } finally { setSavingId(null) }
  }

  return createPortal(<div className="character-modal-backdrop"><section className="character-link-modal" role="dialog" aria-modal="true" aria-label={`Link ${work.displayName} characters`}>
    <header className="character-profile-header"><div><span className="eyebrow">LINK CHARACTERS</span><h2>{work.displayName}</h2><p>Cache first. Jikan suggestions are never confirmed silently, and your personal ranking/comments remain independent.</p></div><button className="character-profile-close" type="button" onClick={onClose}>×</button></header>
    {loading && <div className="character-link-loading"><span className="spinner" /><strong>Loading cached characters and external roster…</strong></div>}
    {error && <div className="notice error character-provider-error"><strong>{providerUnavailable ? '⚠ Jikan temporarily unavailable' : 'Could not load external character roster'}</strong><small>{error}</small><button className="ghost-button compact" type="button" disabled={loading} onClick={() => void loadRoster(true)}>Retry</button></div>}
    {!loading && <div className="character-link-list">{personalCharacters.map((character) => {
      const linked = linkMap.get(character.id)
      const suggestion = suggestions.get(character.id)
      const cachedExternal = linked ? getCachedExternalCharacter(linked.providerCharacterId) : null
      const candidate = linked ? ({ provider: 'jikan', providerCharacterId: linked.providerCharacterId, canonicalName: cachedExternal?.canonicalName ?? linked.canonicalName, imageUrl: cachedExternal?.imageUrl ?? linked.imageUrl, role: cachedExternal?.role ?? linked.role } as ExternalCharacterSummary) : suggestion?.candidate ?? null
      return <article key={character.id} className={linked ? 'character-link-row linked' : 'character-link-row'}>
        <div className="character-link-personal"><span className="character-link-rank">#{character.rank}</span><strong>{character.name}</strong><small>{linked ? `${linked.linkState === 'manual' ? 'Manual link' : 'Linked'} ✓` : 'Personal Knowledge character'}</small></div>
        <div className="character-link-arrow">→</div>
        {candidate ? <div className="character-link-candidate"><CharacterImage src={candidate.imageUrl} name={candidate.canonicalName} /><div><strong>{candidate.canonicalName}</strong><small>{candidate.role ?? 'Role unavailable'} · MAL #{candidate.providerCharacterId}</small>{!linked && suggestion && <span>{Math.round(suggestion.confidence * 100)}% · {suggestion.reason}</span>}</div></div> : <div className="character-link-missing">{providerUnavailable ? 'External provider unavailable — not evaluated' : 'No reliable match found'}</div>}
        <div className="character-link-actions">{linked ? <><button className="ghost-button compact" type="button" onClick={() => setManualId(character.id)}>Change</button><button className="text-button" type="button" disabled={savingId === character.id} onClick={() => void removeLink(character.id)}>Unlink</button></> : <>{candidate && <button className="primary-button compact" type="button" disabled={savingId === character.id} onClick={() => void confirm(character, candidate, false, suggestion?.confidence)}>{savingId === character.id ? 'Saving…' : 'Confirm match'}</button>}<button className="ghost-button compact" type="button" disabled={providerUnavailable && !roster.length} onClick={() => setManualId(character.id)}>Search manually</button></>}</div>
        {manualId === character.id && <ManualCharacterSearch work={work} personalName={character.name} roster={roster} onChoose={(row, manual) => void confirm(character, row, manual)} onClose={() => setManualId(null)} />}
      </article>
    })}</div>}
    <footer className="character-profile-footer"><small>{links.length}/{personalCharacters.length} personal characters linked with Jikan/MAL</small><button className="ghost-button" type="button" onClick={onClose}>Close</button></footer>
  </section></div>, document.body)
}

function CharacterCards({ work, profile }: { work: ManagedCatalogWork; profile: PersonalKnowledge }) {
  const characters = profile.characters.filter((row) => row.confirmed).sort((a, b) => a.rank - b.rank)
  const [links, setLinks] = useState<PersonalCharacterLink[]>(() => getCachedCharacterLinks(work.id))
  const [linkOpen, setLinkOpen] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [profileCharacter, setProfileCharacter] = useState<CharacterKnowledge | null>(null)

  async function refresh() { setLinks(await loadCharacterLinks(work.id)) }
  useEffect(() => { void refresh() }, [work.id])
  const linkMap = useMemo(() => new Map(links.map((row) => [row.personalCharacterId, row])), [links])

  if (!characters.length) return <div className="character-cards-empty">No confirmed characters yet.</div>
  return <>
    <div className="character-cards-toolbar"><small>{links.length}/{characters.length} linked with Jikan/MAL</small><button className="ghost-button compact" type="button" onClick={() => { setFocusId(null); setLinkOpen(true) }}>🔗 Link Characters</button></div>
    <div className="favorite-character-cards">{characters.map((character) => {
      const link = linkMap.get(character.id)
      const cachedExternal = link ? getCachedExternalCharacter(link.providerCharacterId) : null
      const imageUrl = cachedExternal?.imageUrl ?? link?.imageUrl
      const displayName = cachedExternal?.canonicalName ?? link?.canonicalName ?? character.name
      return <button type="button" className={link ? 'favorite-character-card linked' : 'favorite-character-card'} key={character.id} onClick={() => link ? setProfileCharacter(character) : (setFocusId(character.id), setLinkOpen(true))}>
        <div className="favorite-character-image"><CharacterImage src={imageUrl} name={displayName} />{!link && <span className="character-unlinked-badge">Link</span>}</div>
        <div><span>#{character.rank}</span><strong>{displayName}</strong><small>{link ? link.role ?? cachedExternal?.role ?? 'Jikan linked' : 'Character not linked'}</small></div>
      </button>
    })}</div>
    {linkOpen && <LinkCharactersModal work={work} profile={profile} focusCharacterId={focusId} onClose={() => setLinkOpen(false)} onChanged={() => void refresh()} />}
    {profileCharacter && linkMap.get(profileCharacter.id) && <CharacterProfileModal work={work} character={profileCharacter} link={linkMap.get(profileCharacter.id)!} onClose={() => setProfileCharacter(null)} />}
  </>
}

function DetailsCharacterKnowledge({ host, malId }: { host: HTMLElement; malId: number }) {
  const work = useMemo(() => findManagedWorkByMalId(malId), [malId])
  const [profile, setProfile] = useState<PersonalKnowledge | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    if (!work) { setLoading(false); return }
    void loadPersonalKnowledge(work.id, malId)
      .then((row) => { if (live) setProfile(row) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [work?.id, malId])

  return createPortal(<div className="character-knowledge-cards-host">{loading ? <div className="character-cards-loading"><span className="spinner" /> Loading favorite characters…</div> : work && profile ? <CharacterCards work={work} profile={profile} /> : <div className="character-cards-empty">Character knowledge unavailable.</div>}</div>, host)
}

export default function CharacterKnowledgeEnhancer() {
  const location = useLocation()
  const match = location.pathname.match(/^\/app\/anime\/(\d+)$/)
  const malId = match ? Number(match[1]) : null
  const [detailsHost, setDetailsHost] = useState<HTMLElement | null>(null)
  const [workspaceWork, setWorkspaceWork] = useState<ManagedCatalogWork | null>(null)
  const [workspaceProfile, setWorkspaceProfile] = useState<PersonalKnowledge | null>(null)
  const [workspaceLinkOpen, setWorkspaceLinkOpen] = useState(false)

  useEffect(() => {
    let frame = 0
    let mounted: HTMLDivElement | null = null
    let hiddenList: HTMLElement | null = null

    const syncDetails = () => {
      if (!malId || new URLSearchParams(location.search).get('view') === 'analysis') return
      const section = document.querySelector('.personal-knowledge-details-section') as HTMLElement | null
      if (!section) return
      const cards = Array.from(section.querySelectorAll('.personal-knowledge-details-card')) as HTMLElement[]
      const characterCard = cards.find((card) => card.querySelector(':scope > span')?.textContent?.includes('FAVORITE'))
      if (!characterCard) return
      hiddenList = characterCard.querySelector('.personal-knowledge-character-list') as HTMLElement | null
      if (hiddenList) hiddenList.style.display = 'none'
      let host = characterCard.querySelector(':scope > .character-knowledge-cards-host-container') as HTMLDivElement | null
      if (!host) { host = document.createElement('div'); host.className = 'character-knowledge-cards-host-container'; characterCard.appendChild(host) }
      mounted = host; setDetailsHost(host)
    }

    const syncWorkspace = async () => {
      const editor = document.querySelector('.pk-character-editor') as HTMLElement | null
      const header = document.querySelector('.ai-enrichment-header h1') as HTMLElement | null
      if (!editor || !header) return
      const workName = header.textContent?.split(' · ')[0]?.trim()
      const work = listManagedCatalogWorks().find((row) => row.displayName === workName)
      if (!work) return
      if (workspaceWork?.id !== work.id) {
        setWorkspaceWork(work)
        const profile = await loadPersonalKnowledge(work.id, work.primaryMalId)
        setWorkspaceProfile(profile)
      }
      if (!editor.querySelector('.character-link-workspace-button')) {
        const button = document.createElement('button')
        button.type = 'button'; button.className = 'ghost-button character-link-workspace-button'; button.textContent = '🔗 Link Characters with Jikan'
        button.addEventListener('click', () => setWorkspaceLinkOpen(true)); editor.appendChild(button)
      }

      const profile = workspaceProfile ?? await loadPersonalKnowledge(work.id, work.primaryMalId)
      const links = getCachedCharacterLinks(work.id)
      const byId = new Map(links.map((row) => [row.personalCharacterId, row]))
      editor.querySelectorAll('.pk-character-row').forEach((row) => {
        const input = row.querySelector('input') as HTMLInputElement | null
        if (!input || row.querySelector('.character-linked-avatar')) return
        const personal = profile.characters.find((item) => item.name.trim() === input.value.trim())
        const link = personal ? byId.get(personal.id) : null
        if (!link) return
        const external = getCachedExternalCharacter(link.providerCharacterId)
        const imageUrl = external?.imageUrl ?? link.imageUrl
        if (!imageUrl) return
        const image = document.createElement('img'); image.className = 'character-linked-avatar'; image.src = imageUrl; image.alt = ''; image.title = external?.canonicalName ?? link.canonicalName
        image.addEventListener('error', () => image.remove())
        input.insertAdjacentElement('beforebegin', image)
      })
    }

    const sync = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { syncDetails(); void syncWorkspace() }) }
    sync()
    const observer = new MutationObserver(sync)
    const root = document.getElementById('root')
    if (root) observer.observe(root, { childList: true, subtree: true })
    const onUpdate = () => sync()
    window.addEventListener('animefinder:character-knowledge-updated', onUpdate)
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('animefinder:character-knowledge-updated', onUpdate)
      if (hiddenList) hiddenList.style.removeProperty('display'); mounted?.remove(); setDetailsHost(null)
    }
  }, [malId, location.search, workspaceWork?.id, workspaceProfile])

  return <>
    {detailsHost && malId ? <DetailsCharacterKnowledge host={detailsHost} malId={malId} /> : null}
    {workspaceLinkOpen && workspaceWork && workspaceProfile ? <LinkCharactersModal work={workspaceWork} profile={workspaceProfile} onClose={() => setWorkspaceLinkOpen(false)} onChanged={() => { void loadPersonalKnowledge(workspaceWork.id, workspaceWork.primaryMalId).then(setWorkspaceProfile) }} /> : null}
  </>
}
