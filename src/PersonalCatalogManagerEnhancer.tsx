import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Anime } from './types'
import { animeProvider } from './providers'
import CommentEditor from './CommentEditor'
import { listAnimeComments, type AnimeComment } from './comments'
import { personalCatalogCategories, personalCatalogRepository, type PersonalCatalogCategory } from './personalCatalog'
import {
  captureCategoryOverrides,
  clearDraftCatalogState,
  createManagedWorkFromAnime,
  findPotentialDuplicate,
  listManagedCategory,
  normalizeRanks,
  readDraftCatalogState,
  readDynamicCatalogState,
  saveManagedCatalog,
  upsertDynamicWork,
  writeDraftCatalogState,
  type ManagedCatalogWork,
} from './personalCatalogManager'

const CATALOG_STATE_KEY = 'animefinder.personalCatalog.manager.state'
const PERSONAL_CATALOG_SHEET_ID = '1f0oTvblwy5ye5qP5GOlaaLeHh4yETOlRGuPZ-66AF9U'
const SHEET_GIDS: Record<PersonalCatalogCategory, number> = {
  watched: 1588410778,
  movies: 172007828,
  manhua: 1875506751,
  'dropped-unfinished': 118098722,
  'new-seasons-2026': 480971659,
  'needs-classification': 1543390613,
}
const searchCache = new Map<string, Anime[]>()

type SavedUiState = { category?: PersonalCatalogCategory; query?: string; scrollY?: number }

function readUiState(): SavedUiState {
  try { return JSON.parse(sessionStorage.getItem(CATALOG_STATE_KEY) ?? '{}') as SavedUiState } catch { return {} }
}

function saveUiState(state: SavedUiState) {
  sessionStorage.setItem(CATALOG_STATE_KEY, JSON.stringify(state))
}

function CatalogPoster({ work, onOpen }: { work: ManagedCatalogWork; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [image, setImage] = useState(work.posterUrl ?? null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setImage(work.posterUrl ?? null)
    setFailed(false)
    if (work.posterUrl || !work.primaryMalId || !ref.current) return
    let live = true
    const target = ref.current
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void personalCatalogRepository.getMetadata(work.primaryMalId!)
        .then((anime) => { if (live) setImage(anime.imageUrl ?? anime.largeImageUrl ?? null) })
        .catch(() => { if (live) setFailed(true) })
    }, { rootMargin: '280px 0px' })
    observer.observe(target)
    return () => { live = false; observer.disconnect() }
  }, [work.primaryMalId, work.posterUrl])

  return (
    <button ref={ref} className={work.primaryMalId ? 'catalog-poster clickable' : 'catalog-poster'} type="button" disabled={!work.primaryMalId} onClick={work.primaryMalId ? onOpen : undefined}>
      {image && !failed ? <img src={image} alt="" loading="lazy" onError={() => setFailed(true)} /> : <span className="catalog-poster-placeholder">{work.displayName.slice(0, 2).toUpperCase()}</span>}
    </button>
  )
}

function AddAnimeModal({ category, rows, draft, onClose, onAdd }: {
  category: PersonalCatalogCategory
  rows: ManagedCatalogWork[]
  draft: ManagedCatalogWork[]
  onClose: () => void
  onAdd: (work: ManagedCatalogWork) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Anime[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Anime | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const requestSeq = useRef(0)

  useEffect(() => {
    setSelected(null)
    setError('')
    const term = query.trim()
    if (term.length < 2) { setResults([]); setSearching(false); return }
    const key = term.toLowerCase()
    const cached = searchCache.get(key)
    if (cached) { setResults(cached); setSearching(false); return }
    const seq = ++requestSeq.current
    setSearching(true)
    const timer = window.setTimeout(() => {
      void animeProvider.searchAnime(term)
        .then((items) => {
          if (seq !== requestSeq.current) return
          const limited = items.slice(0, 6)
          searchCache.set(key, limited)
          setResults(limited)
        })
        .catch(() => { if (seq === requestSeq.current) setError('Could not search the anime provider right now.') })
        .finally(() => { if (seq === requestSeq.current) setSearching(false) })
    }, 360)
    return () => window.clearTimeout(timer)
  }, [query])

  function choose(anime: Anime) {
    setSelected(anime)
    setDisplayName(anime.title)
    setError('')
  }

  function confirm() {
    if (!selected) return
    const duplicate = findPotentialDuplicate(selected, displayName, draft)
    if (duplicate) {
      setError(`This entry may already belong to “${duplicate.displayName}”. Open that work or use the association flow instead of creating a duplicate.`)
      return
    }
    const rank = category === 'watched' ? rows.length + 1 : null
    onAdd(createManagedWorkFromAnime(selected, displayName, category, rank))
  }

  function addManhuaWithoutMal() {
    const name = displayName.trim() || query.trim()
    if (!name) return
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `manual-${Date.now()}`
    const work: ManagedCatalogWork = {
      id,
      displayName: name,
      anime: name,
      primaryMalId: null,
      malId: null,
      malUrl: null,
      malScore: null,
      originalObservations: null,
      comments: null,
      englishName: null,
      originalName: null,
      myRanked: null,
      watched: false,
      watchStatus: 'unknown',
      category: 'manhua',
      associationMalIds: [],
      pending: true,
      source: 'dynamic',
    }
    onAdd(work)
  }

  return createPortal(
    <div className="catalog-modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
      <section className="catalog-add-modal" role="dialog" aria-modal="true" aria-label="Add Anime">
        <div className="catalog-modal-heading"><div><span className="eyebrow">PERSONAL CATALOG</span><h2>Add Anime</h2></div><button onClick={onClose} aria-label="Close">×</button></div>
        <label className="catalog-add-search"><span>Search anime...</span><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); if (!selected) setDisplayName(event.target.value) }} placeholder="Sword Art Online" /></label>
        {searching && <div className="catalog-search-status"><span className="spinner" /> Searching…</div>}
        {error && <div className="notice error">{error}</div>}
        {!selected && results.length > 0 && <div className="catalog-search-results">{results.map((anime) => <button key={anime.malId} className="catalog-search-result" onClick={() => choose(anime)}><div>{anime.imageUrl ? <img src={anime.imageUrl} alt="" loading="lazy" /> : <span>No image</span>}</div><section><strong>{anime.title}</strong>{anime.titleEnglish && anime.titleEnglish !== anime.title && <small>{anime.titleEnglish}</small>}<span>{[anime.type, anime.year].filter(Boolean).join(' • ') || 'Anime'} · ★ {anime.score?.toFixed(2) ?? '—'}</span></section></button>)}</div>}
        {selected && <div className="catalog-selected-anime"><div>{selected.imageUrl && <img src={selected.imageUrl} alt="" />}</div><section><span className="eyebrow">PRIMARY MAL REFERENCE</span><strong>{selected.title}</strong><small>MAL #{selected.malId} · ★ {selected.score?.toFixed(2) ?? '—'}</small></section></div>}
        {selected && <label className="catalog-name-field"><span>Personal Catalog Name</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>}
        <div className="catalog-modal-actions">
          {selected && <button className="primary-button" onClick={confirm}>Add temporary row</button>}
          {category === 'manhua' && !selected && query.trim() && <button className="ghost-button" onClick={addManhuaWithoutMal}>Add Manhua without MAL ID</button>}
          <button className="text-button" onClick={onClose}>Cancel</button>
        </div>
        <small className="catalog-modal-note">Nothing is persisted until Save Changes. Search results are cached and requests are debounced.</small>
      </section>
    </div>, document.body,
  )
}

function csvCell(value: string | number | null | undefined) {
  const text = value == null ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function downloadCsv(rows: ManagedCatalogWork[], comments: Map<number, AnimeComment>, label: string) {
  const header = ['My Ranked', 'Anime', 'MAL Score', 'Original Observations', 'Comments', 'Full English Name', 'Original Full Name', 'MAL Link', 'Watch Status']
  const body = rows.map((work) => [work.myRanked, work.displayName, work.malScore, work.originalObservations, work.primaryMalId ? comments.get(work.primaryMalId)?.contentText ?? '' : '', work.englishName, work.originalName, work.malUrl, work.watchStatus].map(csvCell).join(','))
  const blob = new Blob([`\uFEFF${[header.map(csvCell).join(','), ...body].join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `AnimeFinder-${label.replace(/[^a-z0-9]+/gi, '-')}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

async function downloadPdf(rows: ManagedCatalogWork[], label: string) {
  const moduleUrl = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm'
  const pdfModule = await import(/* @vite-ignore */ moduleUrl) as { jsPDF: new (options?: Record<string, unknown>) => any }
  const doc = new pdfModule.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  doc.setFillColor(15, 23, 42); doc.rect(0, 0, 297, 26, 'F')
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('AnimeFinder', 12, 11)
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.text(`Personal Catalog · ${label} · ${rows.length} entries`, 12, 19)
  let y = 34
  rows.forEach((work, index) => {
    if (y > 195) { doc.addPage(); y = 16 }
    if (index % 2 === 0) { doc.setFillColor(247, 248, 252); doc.rect(10, y - 5, 277, 11, 'F') }
    doc.setTextColor(124, 92, 246); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text(work.myRanked ? `#${work.myRanked}` : '—', 12, y)
    doc.setTextColor(15, 23, 42); doc.text(work.displayName.slice(0, 62), 27, y)
    doc.setFont('helvetica', 'normal'); doc.text(work.malScore?.toFixed(2) ?? '—', 130, y); doc.text((work.englishName ?? '—').slice(0, 48), 150, y); doc.text(work.watchStatus, 258, y)
    y += 11
  })
  doc.save(`AnimeFinder-${label.replace(/[^a-z0-9]+/gi, '-')}.pdf`)
}

function PersonalCatalogManagerPage() {
  const navigate = useNavigate()
  const savedUi = useMemo(readUiState, [])
  const savedDynamic = useMemo(() => readDynamicCatalogState().dynamicWorks, [])
  const restoredDraft = useMemo(() => readDraftCatalogState()?.dynamicWorks ?? savedDynamic, [])
  const [dynamicDraft, setDynamicDraft] = useState<ManagedCatalogWork[]>(restoredDraft)
  const [category, setCategory] = useState<PersonalCatalogCategory>(savedUi.category ?? 'watched')
  const [query, setQuery] = useState(savedUi.query ?? '')
  const [comments, setComments] = useState<Map<number, AnimeComment>>(new Map())
  const [editingItem, setEditingItem] = useState<ManagedCatalogWork | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [editRanking, setEditRanking] = useState(false)
  const [dirty, setDirty] = useState(JSON.stringify(restoredDraft) !== JSON.stringify(savedDynamic))
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [saveMessage, setSaveMessage] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const dragId = useRef<string | null>(null)

  const allRows = useMemo(() => listManagedCategory(category, dynamicDraft), [category, dynamicDraft])
  const rows = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return allRows
    return allRows.filter((work) => [work.displayName, work.englishName, work.originalName, work.originalObservations].filter(Boolean).join(' ').toLowerCase().includes(term))
  }, [allRows, query])
  const label = personalCatalogCategories.find((item) => item.id === category)?.label ?? 'Catalog'
  const canAdd = category === 'watched' || category === 'movies' || category === 'manhua'

  useEffect(() => { void listAnimeComments().then((items) => setComments(new Map(items.map((item) => [item.malId, item])))) }, [])
  useEffect(() => { saveUiState({ category, query, scrollY: window.scrollY }) }, [category, query])
  useEffect(() => { if (dirty) writeDraftCatalogState(dynamicDraft) }, [dynamicDraft, dirty])
  useEffect(() => {
    if (!fullscreen) return
    const old = document.body.style.overflow; document.body.style.overflow = 'hidden'
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', key)
    return () => { document.body.style.overflow = old; window.removeEventListener('keydown', key) }
  }, [fullscreen])

  function updateDraft(next: ManagedCatalogWork[]) {
    setDynamicDraft(next); setDirty(true); setSaveState('idle'); setSaveMessage('')
  }

  function addTemporary(work: ManagedCatalogWork) {
    updateDraft(upsertDynamicWork(dynamicDraft, work))
    setAddOpen(false)
    if (category === 'watched') setEditRanking(true)
  }

  function reorder(targetId: string) {
    if (!editRanking || !dragId.current || dragId.current === targetId || query) return
    const ordered = listManagedCategory('watched', dynamicDraft)
    const from = ordered.findIndex((work) => work.id === dragId.current)
    const to = ordered.findIndex((work) => work.id === targetId)
    if (from < 0 || to < 0) return
    const next = [...ordered]
    const [moved] = next.splice(from, 1); next.splice(to, 0, moved)
    const ranked = normalizeRanks(next)
    updateDraft(captureCategoryOverrides(dynamicDraft, ranked))
  }

  async function saveChanges() {
    setSaveState('saving'); setSaveMessage('')
    const storage = await saveManagedCatalog(dynamicDraft)
    setDynamicDraft(readDynamicCatalogState().dynamicWorks)
    setDirty(false); setSaveState('saved')
    setSaveMessage(storage === 'supabase' ? 'Saved to Supabase.' : 'Saved locally. Run the Personal Catalog Supabase migration to sync this catalog across devices.')
    window.setTimeout(() => setSaveState('idle'), 1800)
  }

  function cancelChanges() {
    clearDraftCatalogState(); setDynamicDraft(readDynamicCatalogState().dynamicWorks); setDirty(false); setEditRanking(false); setSaveState('idle'); setSaveMessage('')
  }

  function openDetails(work: ManagedCatalogWork) {
    if (!work.primaryMalId) return
    saveUiState({ category, query, scrollY: window.scrollY })
    navigate(`/app/anime/${work.primaryMalId}`)
  }

  const table = <section className={fullscreen ? 'personal-catalog-table-shell fullscreen catalog-manager-shell' : 'personal-catalog-table-shell catalog-manager-shell'}>
    <div className="catalog-manager-toolbar">
      <strong>{allRows.length} {category === 'watched' ? 'anime' : 'entries'}</strong>
      <div className="catalog-manager-actions">
        {canAdd && <button className="primary-button compact" onClick={() => setAddOpen(true)}>+ Add Anime</button>}
        {category === 'watched' && <button className={editRanking ? 'ghost-button active' : 'ghost-button'} onClick={() => setEditRanking((value) => !value)}>{editRanking ? '✓ Editing Ranking' : 'Edit Ranking'}</button>}
        {dirty && <button className="text-button" onClick={cancelChanges}>Cancel Changes</button>}
        <button className={dirty ? 'primary-button' : 'ghost-button'} disabled={!dirty || saveState === 'saving'} onClick={saveChanges}>{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved' : 'Save Changes'}</button>
        <div className="catalog-export-wrap"><button className="catalog-tool-button" onClick={() => setExportOpen((value) => !value)}>⇩</button>{exportOpen && <div className="catalog-export-menu"><button onClick={() => { downloadCsv(rows, comments, label); setExportOpen(false) }}>Download CSV</button><button onClick={() => { window.open(`https://docs.google.com/spreadsheets/d/${PERSONAL_CATALOG_SHEET_ID}/edit#gid=${SHEET_GIDS[category]}`, '_blank', 'noopener,noreferrer'); setExportOpen(false) }}>Open in Google Sheets</button><button onClick={() => { void downloadPdf(rows, label); setExportOpen(false) }}>Download PDF</button></div>}</div>
        <button className="catalog-tool-button" onClick={() => setFullscreen((value) => !value)}>{fullscreen ? '×' : '⛶'}</button>
      </div>
    </div>
    {saveMessage && <div className="catalog-save-message">{saveMessage}</div>}
    {editRanking && category === 'watched' && <div className="catalog-ranking-hint">Drag the ≡ handle to reorder. Ranking changes stay local until Save Changes.</div>}
    {rows.length ? <div className="personal-catalog-table-wrap"><table className="personal-catalog-table catalog-manager-table"><thead><tr>{category === 'watched' && <th>My Ranked</th>}<th>Poster</th><th>Anime</th><th>MAL Score</th><th>Original Observations</th>{category === 'watched' && <th>Comments</th>}<th className="catalog-secondary-column">Full English Name</th><th className="catalog-secondary-column">Original Full Name</th><th className="catalog-mal-column">MyAnimeList</th></tr></thead><tbody>{rows.map((work) => <tr key={work.id} draggable={editRanking && category === 'watched' && !query} onDragStart={() => { dragId.current = work.id }} onDragOver={(event) => { if (editRanking) event.preventDefault() }} onDrop={() => reorder(work.id)} className={work.pending ? 'catalog-new-row' : ''}>
      {category === 'watched' && <td className="catalog-rank-cell">{editRanking && !query && <span className="catalog-drag-handle" title="Drag to reorder">≡</span>}<strong>{work.myRanked ? `#${work.myRanked}` : '—'}</strong>{work.pending && <span className="catalog-new-badge">NEW</span>}</td>}
      <td className="catalog-poster-cell"><CatalogPoster work={work} onOpen={() => openDetails(work)} /></td>
      <td className="catalog-anime-cell"><strong>{work.displayName}</strong>{work.watchStatus === 'watched' && <span className="catalog-watched-chip">✓ Watched</span>}</td>
      <td className="catalog-score-cell">{work.malScore == null ? '—' : <span className="catalog-score">★ {work.malScore.toFixed(2)}</span>}</td>
      <td className="catalog-observation-cell"><span className="catalog-clipped-text" title={work.originalObservations ?? ''}>{work.originalObservations || '—'}</span></td>
      {category === 'watched' && <td className="catalog-comment-cell"><button className="catalog-comment-preview" disabled={!work.primaryMalId} onClick={() => setEditingItem(work)}>{work.primaryMalId ? comments.get(work.primaryMalId)?.contentText || '—' : '—'}</button></td>}
      <td className="catalog-secondary-column">{work.englishName || '—'}</td><td className="catalog-secondary-column">{work.originalName || '—'}</td><td className="catalog-mal-column">{work.malUrl ? <a href={work.malUrl} target="_blank" rel="noreferrer">View on MAL ↗</a> : '—'}</td>
    </tr>)}</tbody></table></div> : <div className="personal-catalog-empty"><strong>No matching entries</strong><span>Try another search or category.</span></div>}
  </section>

  return <div className="page personal-catalog-page catalog-manager-page">
    {!fullscreen && <><section className="page-intro personal-catalog-intro"><span className="eyebrow">PERSONAL CATALOG</span><h1>Personal Catalog</h1><p>Your generalized personal works stay distinct from individual provider seasons, movies and OVAs.</p></section><div className="personal-catalog-search-row"><div className="personal-catalog-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search personal works…" />{query && <button onClick={() => setQuery('')}>×</button>}</div></div><nav className="personal-catalog-tabs">{personalCatalogCategories.map((tab) => <button key={tab.id} className={category === tab.id ? 'active' : ''} onClick={() => { setCategory(tab.id); setEditRanking(false) }}>{tab.label}<span>{listManagedCategory(tab.id, dynamicDraft).length}</span></button>)}</nav></>}
    {table}
    {addOpen && <AddAnimeModal category={category} rows={allRows} draft={dynamicDraft} onClose={() => setAddOpen(false)} onAdd={addTemporary} />}
    {editingItem?.primaryMalId && <CommentEditor malId={editingItem.primaryMalId} animeTitle={editingItem.displayName} initialComment={comments.get(editingItem.primaryMalId)} onClose={() => setEditingItem(null)} onSaved={(comment) => setComments((current) => { const next = new Map(current); next.set(comment.malId, comment); return next })} />}
  </div>
}

export default function PersonalCatalogManagerEnhancer() {
  const location = useLocation()
  const active = location.pathname === '/app/my-anime'
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setHost(null)
    if (!active) return
    let mounted: HTMLDivElement | null = null
    let hidden: HTMLElement | null = null
    const sync = () => {
      const main = document.querySelector('.app-shell > main') as HTMLElement | null
      if (!main) return
      hidden = Array.from(main.children).find((child) => child.classList.contains('page') && !child.classList.contains('personal-catalog-manager-host')) as HTMLElement | null
      if (hidden) hidden.style.display = 'none'
      const existing = main.querySelector(':scope > .personal-catalog-manager-host') as HTMLDivElement | null
      if (existing) { mounted = existing; setHost(existing); return }
      const next = document.createElement('div'); next.className = 'personal-catalog-manager-host'; main.appendChild(next); mounted = next; setHost(next)
    }
    sync()
    const observer = new MutationObserver(sync); const root = document.getElementById('root'); if (root) observer.observe(root, { childList: true, subtree: true })
    return () => { observer.disconnect(); if (hidden) hidden.style.removeProperty('display'); mounted?.remove() }
  }, [active])

  return host && active ? createPortal(<PersonalCatalogManagerPage />, host) : null
}
