import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { animeProvider } from './providers'
import { listWatched } from './catalog'
import {
  associateExternalEntry,
  createAndSaveManagedWork,
  findManagedWorkByMalId,
  isManagedMalIdWatched,
  listManagedCategory,
  normalizePersonalWorkName,
  type ManagedCatalogWork,
} from './personalCatalogManager'

function scoreSuggestion(work: ManagedCatalogWork, title: string) {
  const a = normalizePersonalWorkName(work.displayName)
  const b = normalizePersonalWorkName(title)
  if (a === b) return 100
  if (a && b && (a.includes(b) || b.includes(a))) return 80
  const words = new Set(a.split(' ').filter((word) => word.length > 2))
  return b.split(' ').reduce((score, word) => score + (words.has(word) ? 10 : 0), 0)
}

function AssociationDialog({ malId, onClose, onDone }: { malId: number; onClose: () => void; onDone: () => void }) {
  const [animeTitle, setAnimeTitle] = useState(`MAL #${malId}`)
  const [query, setQuery] = useState('')
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const works = useMemo(() => listManagedCategory('watched'), [malId])
  const visible = useMemo(() => {
    const term = normalizePersonalWorkName(query)
    return [...works]
      .filter((work) => !term || normalizePersonalWorkName(work.displayName).includes(term))
      .sort((a, b) => scoreSuggestion(b, animeTitle) - scoreSuggestion(a, animeTitle))
      .slice(0, 12)
  }, [works, query, animeTitle])

  useEffect(() => {
    let live = true
    void animeProvider.getAnime(malId).then((anime) => {
      if (!live) return
      setAnimeTitle(anime.title)
      setNewName(anime.title)
    }).catch(() => undefined)
    return () => { live = false }
  }, [malId])

  async function associate(work: ManagedCatalogWork) {
    setBusy(true); setError('')
    try { await associateExternalEntry(work, malId); onDone() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not associate this anime.') }
    finally { setBusy(false) }
  }

  async function createNew() {
    if (!newName.trim()) return
    setBusy(true); setError('')
    try {
      const anime = await animeProvider.getAnime(malId)
      await createAndSaveManagedWork(anime, newName.trim(), 'watched')
      onDone()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create the personal work.') }
    finally { setBusy(false) }
  }

  return createPortal(<div className="catalog-modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
    <section className="catalog-add-modal association-modal" role="dialog" aria-modal="true">
      <div className="catalog-modal-heading"><div><span className="eyebrow">PERSONAL WORK</span><h2>Mark as Watched</h2></div><button onClick={onClose}>×</button></div>
      <p className="association-explainer"><strong>{animeTitle}</strong> is an external provider entry. Associate it with one generalized Personal Catalog work, or create a new work.</p>
      {error && <div className="notice error">{error}</div>}
      <div className="association-columns">
        <div>
          <span className="eyebrow">ADD TO EXISTING WORK</span>
          <input className="association-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search personal works…" />
          <div className="association-work-list">{visible.map((work) => <button key={work.id} disabled={busy} onClick={() => associate(work)}><strong>{work.displayName}</strong><small>{work.myRanked ? `#${work.myRanked}` : 'Watched'}{scoreSuggestion(work, animeTitle) >= 20 ? ' · suggested' : ''}</small></button>)}</div>
        </div>
        <div className="association-new-work">
          <span className="eyebrow">CREATE NEW WORK</span>
          <label><span>Personal Catalog Name</span><input value={newName} onChange={(event) => setNewName(event.target.value)} /></label>
          <button className="primary-button" disabled={busy || !newName.trim()} onClick={createNew}>{busy ? 'Saving…' : 'Create new work'}</button>
          <small>A new generalized work is created with this MAL entry as its primary reference.</small>
        </div>
      </div>
    </section>
  </div>, document.body)
}

export default function PersonalWorkAssociationEnhancer() {
  const location = useLocation()
  const match = location.pathname.match(/^\/app\/anime\/(\d+)$/)
  const malId = match ? Number(match[1]) : null
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [watched, setWatched] = useState(false)

  useEffect(() => {
    setHost(null); setDialogOpen(false)
    if (!malId) return
    let mounted: HTMLDivElement | null = null
    let original: HTMLButtonElement | null = null
    const sync = () => {
      const actions = document.querySelector('.details-v2-actions') as HTMLElement | null
      if (!actions) return
      original = actions.querySelector(':scope > button.primary-button') as HTMLButtonElement | null
      if (original) original.style.display = 'none'
      const existing = actions.querySelector(':scope > .personal-work-action-host') as HTMLDivElement | null
      if (existing) { mounted = existing; setHost(existing); return }
      const next = document.createElement('div'); next.className = 'personal-work-action-host'; actions.insertBefore(next, actions.firstChild); mounted = next; setHost(next)
    }
    sync()
    const observer = new MutationObserver(sync); const root = document.getElementById('root'); if (root) observer.observe(root, { childList: true, subtree: true })
    return () => { observer.disconnect(); if (original) original.style.removeProperty('display'); mounted?.remove() }
  }, [malId])

  useEffect(() => {
    if (!malId) return
    setWatched(isManagedMalIdWatched(malId))
    let live = true
    void listWatched().then((rows) => { if (live) setWatched(rows.some((row) => row.mal_id === malId) || isManagedMalIdWatched(malId)) }).catch(() => undefined)
    return () => { live = false }
  }, [malId])

  if (!host || !malId) return null
  const existingWork = findManagedWorkByMalId(malId)
  return <>{createPortal(<button className={watched ? 'primary-button watched-primary' : 'primary-button'} disabled={watched} onClick={() => setDialogOpen(true)}>{watched ? `✓ Watched${existingWork ? ` · ${existingWork.displayName}` : ''}` : '+ Mark as Watched'}</button>, host)}{dialogOpen && <AssociationDialog malId={malId} onClose={() => setDialogOpen(false)} onDone={() => { setDialogOpen(false); setWatched(true) }} />}</>
}
