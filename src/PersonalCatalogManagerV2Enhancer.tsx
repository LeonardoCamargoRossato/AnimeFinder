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
  listManagedCatalogWorks,
  listManagedCategory,
  normalizeRanks,
  readDraftCatalogState,
  readDynamicCatalogState,
  saveManagedCatalog,
  upsertDynamicWork,
  writeDraftCatalogState,
  type ManagedCatalogWork,
} from './personalCatalogManager'
import {
  getCachedPersonalKnowledgeSummaries,
  loadPersonalKnowledgeSummaries,
  type PersonalKnowledgeSummary,
} from './aiPersonalKnowledge'

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
function saveUiState(state: SavedUiState) { sessionStorage.setItem(CATALOG_STATE_KEY, JSON.stringify(state)) }

function openKnowledge(work: ManagedCatalogWork) {
  window.dispatchEvent(new CustomEvent('animefinder:open-personal-knowledge', { detail: { workId: work.id, malId: work.primaryMalId, work } }))
}

function CatalogPoster({ work, onOpen }: { work: ManagedCatalogWork; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [image, setImage] = useState(work.posterUrl ?? null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setImage(work.posterUrl ?? null); setFailed(false)
    if (work.posterUrl || !work.primaryMalId || !ref.current) return
    let live = true
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void personalCatalogRepository.getMetadata(work.primaryMalId!)
        .then((anime) => { if (live) setImage(anime.imageUrl ?? anime.largeImageUrl ?? null) })
        .catch(() => { if (live) setFailed(true) })
    }, { rootMargin: '280px 0px' })
    observer.observe(ref.current)
    return () => { live = false; observer.disconnect() }
  }, [work.primaryMalId, work.posterUrl])
  return <button ref={ref} className={work.primaryMalId ? 'catalog-poster clickable' : 'catalog-poster'} type="button" disabled={!work.primaryMalId} onClick={work.primaryMalId ? onOpen : undefined}>{image && !failed ? <img src={image} alt="" loading="lazy" onError={() => setFailed(true)} /> : <span className="catalog-poster-placeholder">{work.displayName.slice(0, 2).toUpperCase()}</span>}</button>
}

function GenreCell({ work }: { work: ManagedCatalogWork }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const cached = work.primaryMalId ? personalCatalogRepository.getCachedMetadata(work.primaryMalId) : null
  const [genres, setGenres] = useState<string[]>(cached?.genres.slice(0, 3).map((genre) => genre.name) ?? [])
  useEffect(() => {
    if (!work.primaryMalId || genres.length || !ref.current) return
    let live = true
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void personalCatalogRepository.getMetadata(work.primaryMalId!)
        .then((anime) => { if (live) setGenres(anime.genres.slice(0, 3).map((genre) => genre.name)) })
        .catch(() => undefined)
    }, { rootMargin: '220px 0px' })
    observer.observe(ref.current)
    return () => { live = false; observer.disconnect() }
  }, [work.primaryMalId, genres.length])
  return <div ref={ref} className="catalog-mini-pills">{genres.length ? genres.map((genre) => <span key={genre}>{genre}</span>) : <span className="muted-pill">—</span>}</div>
}

function ChipList({ values, limit = 3 }: { values: string[]; limit?: number }) {
  const visible = values.slice(0, limit)
  const extra = Math.max(0, values.length - visible.length)
  return <div className="catalog-mini-pills">{visible.length ? visible.map((value) => <span key={value}>{value}</span>) : <span className="muted-pill">—</span>}{extra > 0 && <span className="more-pill">+{extra}</span>}</div>
}

function AddAnimeModal({ category, rows, draft, onClose, onAdd }: {
  category: PersonalCatalogCategory
  rows: ManagedCatalogWork[]
  draft: ManagedCatalogWork[]
  onClose: () => void
  onAdd: (work: ManagedCatalogWork, enrichAfter: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Anime[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Anime | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [initialRank, setInitialRank] = useState('')
  const [classifyLater, setClassifyLater] = useState(false)
  const [enrichAfter, setEnrichAfter] = useState(false)
  const [error, setError] = useState('')
  const requestSeq = useRef(0)

  useEffect(() => {
    setSelected(null); setError('')
    const term = query.trim()
    if (term.length < 2) { setResults([]); setSearching(false); return }
    const key = term.toLowerCase()
    const cached = searchCache.get(key)
    if (cached) { setResults(cached); setSearching(false); return }
    const seq = ++requestSeq.current
    setSearching(true)
    const timer = window.setTimeout(() => {
      void animeProvider.searchAnime(term)
        .then((items) => { if (seq === requestSeq.current) { const limited = items.slice(0, 6); searchCache.set(key, limited); setResults(limited) } })
        .catch(() => { if (seq === requestSeq.current) setError('Could not search the anime provider right now.') })
        .finally(() => { if (seq === requestSeq.current) setSearching(false) })
    }, 360)
    return () => window.clearTimeout(timer)
  }, [query])

  function choose(anime: Anime) { setSelected(anime); setDisplayName(anime.title); setError('') }

  function confirm() {
    if (!selected) return
    const duplicate = findPotentialDuplicate(selected, displayName, draft)
    if (duplicate) { setError(`This entry may already belong to “${duplicate.displayName}”. Open that work or use the association flow instead of creating a duplicate.`); return }
    const targetCategory: PersonalCatalogCategory = classifyLater ? 'needs-classification' : category
    const parsed = initialRank.trim() ? Number(initialRank) : null
    const rank = targetCategory === 'watched' ? (Number.isFinite(parsed) && parsed! > 0 ? Math.max(1, Math.min(rows.length + 1, Math.floor(parsed!))) : rows.length + 1) : null
    onAdd(createManagedWorkFromAnime(selected, displayName, targetCategory, rank), enrichAfter)
  }

  function addManhuaWithoutMal() {
    const name = displayName.trim() || query.trim()
    if (!name) return
    const work: ManagedCatalogWork = {
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `manual-${Date.now()}`,
      displayName: name, anime: name, primaryMalId: null, malId: null, malUrl: null, malScore: null,
      originalObservations: null, comments: null, englishName: null, originalName: null, myRanked: null,
      watched: false, watchStatus: 'unknown', category: 'manhua', associationMalIds: [], pending: true, source: 'dynamic',
    }
    onAdd(work, enrichAfter)
  }

  return createPortal(<div className="catalog-modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}><section className="catalog-add-modal catalog-add-modal-v2" role="dialog" aria-modal="true" aria-label="Add Anime">
    <div className="catalog-modal-heading"><div><span className="eyebrow">PERSONAL CATALOG</span><h2>Add Anime</h2></div><button onClick={onClose} aria-label="Close">×</button></div>
    <label className="catalog-add-search"><span>Search anime</span><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); if (!selected) setDisplayName(event.target.value) }} placeholder="World Trigger" /></label>
    {searching && <div className="catalog-search-status"><span className="spinner" /> Searching…</div>}
    {error && <div className="notice error">{error}</div>}
    {!selected && results.length > 0 && <div className="catalog-search-results">{results.map((anime) => <button key={anime.malId} className="catalog-search-result" onClick={() => choose(anime)}><div>{anime.imageUrl ? <img src={anime.imageUrl} alt="" loading="lazy" /> : <span>No image</span>}</div><section><strong>{anime.title}</strong>{anime.titleEnglish && anime.titleEnglish !== anime.title && <small>{anime.titleEnglish}</small>}<span>{[anime.type, anime.year].filter(Boolean).join(' • ') || 'Anime'} · ★ {anime.score?.toFixed(2) ?? '—'}</span></section></button>)}</div>}
    {selected && <><div className="catalog-selected-anime"><div>{selected.imageUrl && <img src={selected.imageUrl} alt="" />}</div><section><span className="eyebrow">PRIMARY MAL REFERENCE</span><strong>{selected.title}</strong><small>MAL #{selected.malId} · ★ {selected.score?.toFixed(2) ?? '—'}</small></section></div>
      <label className="catalog-name-field"><span>Personal Catalog Name</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
      {category === 'watched' && !classifyLater && <label className="catalog-name-field"><span>Initial rank <small>Optional — temporary insertion position</small></span><input type="number" min={1} max={rows.length + 1} value={initialRank} onChange={(event) => setInitialRank(event.target.value)} placeholder={`1–${rows.length + 1}`} /></label>}
      <label className="catalog-choice-row"><input type="checkbox" checked={classifyLater} onChange={(event) => setClassifyLater(event.target.checked)} /><span><strong>Classify later</strong><small>Send this work to Needs Classification. It will not be marked as watched or receive a final rank.</small></span></label>
      <label className="catalog-choice-row"><input type="checkbox" checked={enrichAfter} onChange={(event) => setEnrichAfter(event.target.checked)} /><span><strong>Open AI Personal Knowledge after adding</strong><small>Optional. You can enrich this work now or later.</small></span></label>
    </>}
    <div className="catalog-modal-actions">{selected && <button className="primary-button" onClick={confirm}>Add temporary row</button>}{category === 'manhua' && !selected && query.trim() && <button className="ghost-button" onClick={addManhuaWithoutMal}>Add Manhua without MAL ID</button>}<button className="text-button" onClick={onClose}>Cancel</button></div>
    <small className="catalog-modal-note">Nothing is persisted until Save Changes. Initial rank only controls the temporary insertion position.</small>
  </section></div>, document.body)
}

function csvCell(value: string | number | null | undefined) { const text = value == null ? '' : String(value); return `"${text.replace(/"/g, '""')}"` }
function downloadCsv(rows: ManagedCatalogWork[], comments: Map<number, AnimeComment>, summaries: Map<string, PersonalKnowledgeSummary>, label: string) {
  const header = ['My Ranked', 'Anime', 'MAL Score', 'Original Observations', 'Comments', 'Characters', 'Keywords', 'Full English Name', 'Original Full Name', 'MAL Link', 'Watch Status']
  const body = rows.map((work) => { const summary = summaries.get(work.id); return [work.myRanked, work.displayName, work.malScore, work.originalObservations, work.primaryMalId ? comments.get(work.primaryMalId)?.contentText ?? summary?.currentComment ?? '' : summary?.currentComment ?? '', summary?.characters.join(' | ') ?? '', summary?.keywords.join(' | ') ?? '', work.englishName, work.originalName, work.malUrl, work.watchStatus].map(csvCell).join(',') })
  const blob = new Blob([`\uFEFF${[header.map(csvCell).join(','), ...body].join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `AnimeFinder-${label.replace(/[^a-z0-9]+/gi, '-')}.csv`; anchor.click(); URL.revokeObjectURL(url)
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
  const [knowledge, setKnowledge] = useState<Map<string, PersonalKnowledgeSummary>>(() => getCachedPersonalKnowledgeSummaries())
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
  const rows = useMemo(() => { const term = query.trim().toLowerCase(); if (!term) return allRows; return allRows.filter((work) => [work.displayName, work.englishName, work.originalName, work.originalObservations].filter(Boolean).join(' ').toLowerCase().includes(term)) }, [allRows, query])
  const label = personalCatalogCategories.find((item) => item.id === category)?.label ?? 'Catalog'
  const canAdd = category === 'watched' || category === 'movies' || category === 'manhua'
  const showKnowledgeColumns = category === 'watched'

  async function refreshKnowledge() {
    const ids = listManagedCatalogWorks(dynamicDraft).map((work) => work.id)
    setKnowledge(getCachedPersonalKnowledgeSummaries(ids))
    const summaries = await loadPersonalKnowledgeSummaries(ids)
    setKnowledge(summaries)
  }

  useEffect(() => { void listAnimeComments().then((items) => setComments(new Map(items.map((item) => [item.malId, item])))); void refreshKnowledge() }, [])
  useEffect(() => { const handler = () => { void refreshKnowledge(); void listAnimeComments().then((items) => setComments(new Map(items.map((item) => [item.malId, item])))) }; window.addEventListener('animefinder:personal-knowledge-updated', handler); return () => window.removeEventListener('animefinder:personal-knowledge-updated', handler) })
  useEffect(() => { saveUiState({ category, query, scrollY: window.scrollY }) }, [category, query])
  useEffect(() => { if (dirty) writeDraftCatalogState(dynamicDraft) }, [dynamicDraft, dirty])
  useEffect(() => { if (!fullscreen) return; const old = document.body.style.overflow; document.body.style.overflow = 'hidden'; const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setFullscreen(false) }; window.addEventListener('keydown', key); return () => { document.body.style.overflow = old; window.removeEventListener('keydown', key) } }, [fullscreen])

  function updateDraft(next: ManagedCatalogWork[]) { setDynamicDraft(next); setDirty(true); setSaveState('idle'); setSaveMessage('') }

  function addTemporary(work: ManagedCatalogWork, enrichAfter: boolean) {
    let nextDraft = upsertDynamicWork(dynamicDraft, work)
    if (work.category === 'watched') {
      const ordered = listManagedCategory('watched', dynamicDraft)
      const target = Math.max(0, Math.min(ordered.length, (work.myRanked ?? ordered.length + 1) - 1))
      const nextOrdered = [...ordered]
      nextOrdered.splice(target, 0, work)
      nextDraft = captureCategoryOverrides(nextDraft, normalizeRanks(nextOrdered))
      setEditRanking(true)
      setCategory('watched')
    } else if (work.category === 'needs-classification') {
      setCategory('needs-classification'); setEditRanking(false); setQuery('')
    }
    updateDraft(nextDraft)
    setAddOpen(false)
    if (enrichAfter) window.setTimeout(() => openKnowledge(work), 50)
  }

  function reorder(targetId: string) {
    if (!editRanking || !dragId.current || dragId.current === targetId || query) return
    const ordered = listManagedCategory('watched', dynamicDraft)
    const from = ordered.findIndex((work) => work.id === dragId.current); const to = ordered.findIndex((work) => work.id === targetId)
    if (from < 0 || to < 0) return
    const next = [...ordered]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved)
    updateDraft(captureCategoryOverrides(dynamicDraft, normalizeRanks(next)))
  }

  async function saveChanges() {
    setSaveState('saving'); setSaveMessage('')
    const storage = await saveManagedCatalog(dynamicDraft)
    setDynamicDraft(readDynamicCatalogState().dynamicWorks); setDirty(false); setSaveState('saved')
    setSaveMessage(storage === 'supabase' ? 'Saved to Supabase.' : 'Saved locally. Run the Personal Catalog Supabase migration to sync this catalog across devices.')
    window.setTimeout(() => setSaveState('idle'), 1800)
  }
  function cancelChanges() { clearDraftCatalogState(); setDynamicDraft(readDynamicCatalogState().dynamicWorks); setDirty(false); setEditRanking(false); setSaveState('idle'); setSaveMessage('') }
  function openDetails(work: ManagedCatalogWork) { if (!work.primaryMalId) return; saveUiState({ category, query, scrollY: window.scrollY }); navigate(`/app/anime/${work.primaryMalId}`) }

  const table = <section className={fullscreen ? 'personal-catalog-table-shell fullscreen catalog-manager-shell catalog-v2-shell' : 'personal-catalog-table-shell catalog-manager-shell catalog-v2-shell'}>
    <div className="catalog-manager-toolbar"><strong>{allRows.length} {category === 'watched' ? 'anime' : 'entries'}</strong><div className="catalog-manager-actions">
      {canAdd && <button className="primary-button compact" onClick={() => setAddOpen(true)}>+ Add Anime</button>}
      {category === 'watched' && <button className={editRanking ? 'ghost-button active' : 'ghost-button'} onClick={() => setEditRanking((value) => !value)}>{editRanking ? '✓ Editing Ranking' : 'Edit Ranking'}</button>}
      {dirty && <button className="text-button" onClick={cancelChanges}>Cancel Changes</button>}
      <button className={dirty ? 'primary-button' : 'ghost-button'} disabled={!dirty || saveState === 'saving'} onClick={saveChanges}>{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved' : 'Save Changes'}</button>
      <div className="catalog-export-wrap"><button className="catalog-tool-button" onClick={() => setExportOpen((value) => !value)}>⇩</button>{exportOpen && <div className="catalog-export-menu"><button onClick={() => { downloadCsv(rows, comments, knowledge, label); setExportOpen(false) }}>Download CSV</button><button onClick={() => { window.open(`https://docs.google.com/spreadsheets/d/${PERSONAL_CATALOG_SHEET_ID}/edit#gid=${SHEET_GIDS[category]}`, '_blank', 'noopener,noreferrer'); setExportOpen(false) }}>Open in Google Sheets</button></div>}</div>
      <button className="catalog-tool-button" onClick={() => setFullscreen((value) => !value)}>{fullscreen ? '×' : '⛶'}</button>
    </div></div>
    {saveMessage && <div className="catalog-save-message">{saveMessage}</div>}
    {editRanking && category === 'watched' && <div className="catalog-ranking-hint">Drag the ≡ handle to reorder. Ranking changes stay local until Save Changes.</div>}
    {rows.length ? <div className="personal-catalog-table-wrap"><table className="personal-catalog-table catalog-manager-table catalog-v2-table"><thead><tr>{category === 'watched' && <th>My Ranked</th>}<th>Poster</th><th>Anime</th><th>MAL Score</th><th>Original Observations</th>{showKnowledgeColumns && <><th>Comments</th><th>Characters</th><th>Keywords</th><th>Genres</th></>}<th className="catalog-secondary-column">Full English Name</th><th className="catalog-secondary-column">Original Full Name</th><th className="catalog-mal-column">MyAnimeList</th>{showKnowledgeColumns && <th>Knowledge</th>}</tr></thead><tbody>{rows.map((work) => { const summary = knowledge.get(work.id); return <tr key={work.id} draggable={editRanking && category === 'watched' && !query} onDragStart={() => { dragId.current = work.id }} onDragOver={(event) => { if (editRanking) event.preventDefault() }} onDrop={() => reorder(work.id)} className={work.pending ? 'catalog-new-row' : ''}>
      {category === 'watched' && <td className="catalog-rank-cell">{editRanking && !query && <span className="catalog-drag-handle" title="Drag to reorder">≡</span>}<strong>{work.myRanked ? `#${work.myRanked}` : '—'}</strong>{work.pending && <span className="catalog-new-badge">NEW</span>}</td>}
      <td className="catalog-poster-cell"><CatalogPoster work={work} onOpen={() => openDetails(work)} /></td>
      <td className="catalog-anime-cell"><strong>{work.displayName}</strong>{work.watchStatus === 'watched' && <span className="catalog-watched-chip">✓ Watched</span>}</td>
      <td className="catalog-score-cell">{work.malScore == null ? '—' : <span className="catalog-score">★ {work.malScore.toFixed(2)}</span>}</td>
      <td className="catalog-observation-cell"><span className="catalog-clipped-text" title={work.originalObservations ?? ''}>{work.originalObservations || '—'}</span></td>
      {showKnowledgeColumns && <><td className="catalog-comment-cell"><button className="catalog-comment-preview" disabled={!work.primaryMalId} onClick={() => setEditingItem(work)}>{work.primaryMalId ? comments.get(work.primaryMalId)?.contentText || summary?.currentComment || '—' : summary?.currentComment || '—'}</button></td><td><ChipList values={summary?.characters ?? []} /></td><td><ChipList values={summary?.keywords ?? []} /></td><td><GenreCell work={work} /></td></>}
      <td className="catalog-secondary-column">{work.englishName || '—'}</td><td className="catalog-secondary-column">{work.originalName || '—'}</td><td className="catalog-mal-column">{work.malUrl ? <a href={work.malUrl} target="_blank" rel="noreferrer">View on MAL ↗</a> : '—'}</td>{showKnowledgeColumns && <td><button className={summary?.hasKnowledge ? 'ai-enrich-entry enriched' : 'ai-enrich-entry'} type="button" onClick={() => openKnowledge(work)}>{summary?.hasKnowledge ? '✓ Knowledge' : '✨ Enrich'}</button></td>}
    </tr>})}</tbody></table></div> : <div className="personal-catalog-empty"><strong>No matching entries</strong><span>Try another search or category.</span></div>}
  </section>

  return <div className="page personal-catalog-page catalog-manager-page">
    {!fullscreen && <><section className="page-intro personal-catalog-intro"><span className="eyebrow">PERSONAL CATALOG</span><h1>Personal Catalog</h1><p>External metadata, personal knowledge and catalog status stay connected without being mixed together.</p></section><div className="personal-catalog-search-row"><div className="personal-catalog-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search personal works…" />{query && <button onClick={() => setQuery('')}>×</button>}</div></div><nav className="personal-catalog-tabs">{personalCatalogCategories.map((tab) => <button key={tab.id} className={category === tab.id ? 'active' : ''} onClick={() => { setCategory(tab.id); setEditRanking(false) }}>{tab.label}<span>{listManagedCategory(tab.id, dynamicDraft).length}</span></button>)}</nav></>}
    {table}
    {addOpen && <AddAnimeModal category={category} rows={allRows} draft={dynamicDraft} onClose={() => setAddOpen(false)} onAdd={addTemporary} />}
    {editingItem?.primaryMalId && <CommentEditor malId={editingItem.primaryMalId} animeTitle={editingItem.displayName} initialComment={comments.get(editingItem.primaryMalId)} onClose={() => setEditingItem(null)} onSaved={(comment) => setComments((current) => { const next = new Map(current); next.set(comment.malId, comment); return next })} />}
  </div>
}

export default function PersonalCatalogManagerV2Enhancer() {
  const location = useLocation()
  const active = location.pathname === '/app/my-anime'
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setHost(null); if (!active) return
    let mounted: HTMLDivElement | null = null; let hidden: HTMLElement | null = null
    const sync = () => {
      const main = document.querySelector('.app-shell > main') as HTMLElement | null
      if (!main) return
      hidden = Array.from(main.children).find((child) => child.classList.contains('page') && !child.classList.contains('personal-catalog-manager-v2-host')) as HTMLElement | null
      if (hidden) hidden.style.display = 'none'
      const existing = main.querySelector(':scope > .personal-catalog-manager-v2-host') as HTMLDivElement | null
      if (existing) { mounted = existing; setHost(existing); return }
      const next = document.createElement('div'); next.className = 'personal-catalog-manager-v2-host'; main.appendChild(next); mounted = next; setHost(next)
    }
    sync(); const observer = new MutationObserver(sync); const root = document.getElementById('root'); if (root) observer.observe(root, { childList: true, subtree: true })
    return () => { observer.disconnect(); if (hidden) hidden.style.removeProperty('display'); mounted?.remove() }
  }, [active])
  return host && active ? createPortal(<PersonalCatalogManagerPage />, host) : null
}
