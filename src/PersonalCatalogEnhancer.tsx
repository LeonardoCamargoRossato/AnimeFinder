import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Anime } from './types'
import CommentEditor from './CommentEditor'
import { listAnimeComments, type AnimeComment } from './comments'
import {
  personalCatalogCategories,
  personalCatalogRepository,
  type PersonalCatalogCategory,
  type PersonalCatalogItem,
} from './personalCatalog'

const CATALOG_STATE_KEY = 'animefinder.personalCatalog.state'
const PERSONAL_CATALOG_SHEET_ID = '1f0oTvblwy5ye5qP5GOlaaLeHh4yETOlRGuPZ-66AF9U'
const SHEET_GIDS: Record<PersonalCatalogCategory, number> = {
  watched: 1588410778,
  movies: 172007828,
  manhua: 1875506751,
  'dropped-unfinished': 118098722,
  'new-seasons-2026': 480971659,
  'needs-classification': 1543390613,
}

type CatalogState = {
  category?: PersonalCatalogCategory
  query?: string
  scrollY?: number
}

function readSavedState(): CatalogState {
  try {
    return JSON.parse(sessionStorage.getItem(CATALOG_STATE_KEY) ?? '{}') as CatalogState
  } catch {
    return {}
  }
}

function saveState(state: CatalogState) {
  sessionStorage.setItem(CATALOG_STATE_KEY, JSON.stringify(state))
}

function CatalogPoster({ item, onOpen }: { item: PersonalCatalogItem; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [metadata, setMetadata] = useState<Anime | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!item.malId || !ref.current) return
    let live = true
    const target = ref.current
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void personalCatalogRepository.getMetadata(item.malId!)
        .then((anime) => live && setMetadata(anime))
        .catch(() => live && setFailed(true))
    }, { rootMargin: '320px 0px' })
    observer.observe(target)
    return () => {
      live = false
      observer.disconnect()
    }
  }, [item.malId])

  const image = metadata?.imageUrl ?? metadata?.largeImageUrl
  return (
    <button
      ref={ref}
      type="button"
      className={item.malId ? 'catalog-poster clickable' : 'catalog-poster'}
      onClick={item.malId ? onOpen : undefined}
      disabled={!item.malId}
      title={item.malId ? `Open ${item.anime}` : 'No MyAnimeList ID available'}
    >
      {image && !failed
        ? <img src={image} alt="" loading="lazy" onError={() => setFailed(true)} />
        : <span className="catalog-poster-placeholder">{item.anime.slice(0, 2).toUpperCase()}</span>}
    </button>
  )
}

function ObservationCell({ value }: { value: string | null }) {
  const [expanded, setExpanded] = useState(false)
  if (!value) return <span className="catalog-empty">—</span>
  return (
    <button
      type="button"
      className={expanded ? 'catalog-observation expanded' : 'catalog-observation'}
      onClick={() => setExpanded((current) => !current)}
      title={expanded ? 'Collapse original observation' : 'Read full original observation'}
    >
      {value}
    </button>
  )
}

function CommentCell({ comment, disabled, onOpen }: { comment?: AnimeComment; disabled?: boolean; onOpen: () => void }) {
  if (disabled) return <span className="catalog-empty">—</span>
  return (
    <button
      type="button"
      className={comment?.contentText ? 'catalog-comment-preview' : 'catalog-comment-preview empty'}
      onClick={onOpen}
      title="Open comment editor"
    >
      {comment?.contentText || '—'}
    </button>
  )
}

function CatalogRow({
  item,
  showRank,
  showComments,
  comment,
  onOpen,
  onOpenComment,
}: {
  item: PersonalCatalogItem
  showRank: boolean
  showComments: boolean
  comment?: AnimeComment
  onOpen: () => void
  onOpenComment: () => void
}) {
  return (
    <tr>
      {showRank && <td className="catalog-rank-cell">{item.myRanked == null ? <span className="catalog-empty">—</span> : <strong>#{item.myRanked}</strong>}</td>}
      <td className="catalog-poster-cell"><CatalogPoster item={item} onOpen={onOpen} /></td>
      <td className="catalog-anime-cell">
        <strong>{item.anime}</strong>
        {item.watched && <span className="catalog-watched-chip">✓ Watched</span>}
        <span className="catalog-mobile-alt">{item.englishName || item.originalName || '—'}</span>
      </td>
      <td className="catalog-score-cell">
        {item.malScore == null ? <span className="catalog-empty">—</span> : <span className="catalog-score">★ {item.malScore.toFixed(2)}</span>}
      </td>
      <td className="catalog-observation-cell"><ObservationCell value={item.originalObservations} /></td>
      {showComments && <td className="catalog-comment-cell"><CommentCell comment={comment} disabled={!item.malId} onOpen={onOpenComment} /></td>}
      <td className="catalog-secondary-column">{item.englishName ?? <span className="catalog-empty">—</span>}</td>
      <td className="catalog-secondary-column">{item.originalName ?? <span className="catalog-empty">—</span>}</td>
      <td className="catalog-mal-column">
        {item.malUrl
          ? <a href={item.malUrl} target="_blank" rel="noreferrer" className="catalog-mal-link">View on MAL ↗</a>
          : <span className="catalog-empty">—</span>}
      </td>
    </tr>
  )
}

function csvCell(value: string | number | null | undefined) {
  const text = value == null ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function downloadCsv(rows: PersonalCatalogItem[], categoryLabel: string, comments: Map<number, AnimeComment>) {
  const showComments = rows.some((item) => item.category === 'watched')
  const header = ['My Ranked', 'Anime', 'MyAnimeList Score', 'Original Observations', ...(showComments ? ['Comments'] : []), 'Full English Name', 'Original Full Name', 'MyAnimeList Link']
  const body = rows.map((item) => [
    item.myRanked,
    item.anime,
    item.malScore,
    item.originalObservations,
    ...(showComments ? [item.malId ? comments.get(item.malId)?.contentText ?? '' : ''] : []),
    item.englishName,
    item.originalName,
    item.malUrl,
  ].map(csvCell).join(','))
  const csv = `\uFEFF${[header.map(csvCell).join(','), ...body].join('\n')}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `AnimeFinder-${categoryLabel.replace(/[^a-z0-9]+/gi, '-')}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

async function downloadPdf(rows: PersonalCatalogItem[], categoryLabel: string, comments: Map<number, AnimeComment>) {
  const moduleUrl = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm'
  const pdfModule = await import(/* @vite-ignore */ moduleUrl) as { jsPDF: new (options?: Record<string, unknown>) => any }
  const doc = new pdfModule.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageWidth = 297
  const pageHeight = 210
  const margin = 10
  const purple: [number, number, number] = [124, 92, 246]
  const navy: [number, number, number] = [15, 23, 42]
  const muted: [number, number, number] = [88, 99, 120]
  const showComments = rows.some((item) => item.category === 'watched')

  const drawHeader = (page: number) => {
    doc.setFillColor(...navy)
    doc.rect(0, 0, pageWidth, 25, 'F')
    doc.setFillColor(...purple)
    doc.rect(0, 25, pageWidth, 2, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(17)
    doc.text('AnimeFinder', margin, 11)
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(`Personal Catalog · ${categoryLabel}`, margin, 18)
    doc.setFontSize(8)
    doc.text(`Page ${page} · ${rows.length} entries`, pageWidth - margin, 15, { align: 'right' })
  }

  const widths = showComments
    ? [16, 45, 18, 66, 55, 32, 32]
    : [16, 50, 20, 88, 45, 45]
  const headers = showComments
    ? ['RANK', 'ANIME', 'MAL', 'ORIGINAL OBSERVATIONS', 'COMMENTS', 'ENGLISH', 'ORIGINAL']
    : ['RANK', 'ANIME', 'MAL', 'ORIGINAL OBSERVATIONS', 'ENGLISH', 'ORIGINAL']
  const xs: number[] = []
  let x = margin
  widths.forEach((width) => { xs.push(x); x += width })

  const truncate = (value: string, width: number, maxLines = 3) => {
    const lines = doc.splitTextToSize(value || '—', width - 4) as string[]
    return lines.length > maxLines ? [...lines.slice(0, maxLines - 1), `${lines[maxLines - 1]}…`] : lines
  }

  let page = 1
  let y = 31
  const drawColumns = () => {
    doc.setFillColor(245, 246, 250)
    doc.roundedRect(margin, y, pageWidth - margin * 2, 9, 1.5, 1.5, 'F')
    doc.setTextColor(...muted)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.7)
    headers.forEach((header, index) => doc.text(header, xs[index] + 2, y + 5.6))
    y += 11
  }
  drawHeader(page)
  drawColumns()

  rows.forEach((item, index) => {
    const rowHeight = 17
    if (y + rowHeight > pageHeight - 12) {
      doc.addPage()
      page += 1
      y = 31
      drawHeader(page)
      drawColumns()
    }
    if (index % 2 === 0) {
      doc.setFillColor(250, 250, 253)
      doc.rect(margin, y - 2, pageWidth - margin * 2, rowHeight, 'F')
    }
    const commentText = item.malId ? comments.get(item.malId)?.contentText ?? '—' : '—'
    const values = showComments
      ? [item.myRanked == null ? '—' : `#${item.myRanked}`, item.anime, item.malScore?.toFixed(2) ?? '—', item.originalObservations ?? '—', commentText, item.englishName ?? '—', item.originalName ?? '—']
      : [item.myRanked == null ? '—' : `#${item.myRanked}`, item.anime, item.malScore?.toFixed(2) ?? '—', item.originalObservations ?? '—', item.englishName ?? '—', item.originalName ?? '—']
    doc.setFontSize(7)
    values.forEach((value, column) => {
      doc.setTextColor(...(column === 0 ? purple : navy))
      doc.setFont('helvetica', column <= 2 ? 'bold' : 'normal')
      doc.text(truncate(String(value), widths[column], 3), xs[column] + 2, y + 3.8)
    })
    y += rowHeight
  })

  const totalPages = doc.getNumberOfPages()
  const generated = new Date().toLocaleString()
  for (let i = 1; i <= totalPages; i += 1) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...muted)
    doc.text(`Generated by AnimeFinder · ${generated}`, margin, pageHeight - 5)
    doc.text(`${i} / ${totalPages}`, pageWidth - margin, pageHeight - 5, { align: 'right' })
  }
  doc.save(`AnimeFinder-${categoryLabel.replace(/[^a-z0-9]+/gi, '-')}.pdf`)
}

function PersonalCatalogPage() {
  const navigate = useNavigate()
  const saved = useMemo(readSavedState, [])
  const [category, setCategory] = useState<PersonalCatalogCategory>(saved.category ?? 'watched')
  const [query, setQuery] = useState(saved.query ?? '')
  const [fullscreen, setFullscreen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [comments, setComments] = useState<Map<number, AnimeComment>>(new Map())
  const [editingItem, setEditingItem] = useState<PersonalCatalogItem | null>(null)
  const rows = useMemo(() => personalCatalogRepository.search(category, query), [category, query])
  const showRank = category === 'watched'
  const showComments = category === 'watched'
  const restored = useRef(false)
  const categoryLabel = personalCatalogCategories.find((tab) => tab.id === category)?.label ?? 'Catalog'

  useEffect(() => {
    void listAnimeComments().then((items) => setComments(new Map(items.map((item) => [item.malId, item]))))
  }, [])

  useEffect(() => {
    saveState({ category, query, scrollY: window.scrollY })
  }, [category, query])

  useEffect(() => {
    if (restored.current || saved.scrollY == null) return
    restored.current = true
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo({ top: saved.scrollY ?? 0, behavior: 'auto' })))
  }, [saved.scrollY, rows.length])

  useEffect(() => {
    if (!fullscreen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [fullscreen])

  function openDetails(item: PersonalCatalogItem) {
    if (!item.malId) return
    saveState({ category, query, scrollY: window.scrollY })
    navigate(`/app/anime/${item.malId}`, { state: { fromPersonalCatalog: true } })
  }

  function openGoogleSheet() {
    window.open(`https://docs.google.com/spreadsheets/d/${PERSONAL_CATALOG_SHEET_ID}/edit#gid=${SHEET_GIDS[category]}`, '_blank', 'noopener,noreferrer')
  }

  async function exportPdf() {
    if (exportingPdf) return
    setExportingPdf(true)
    setExportOpen(false)
    try { await downloadPdf(rows, categoryLabel, comments) }
    catch { window.alert('Could not generate the PDF. Please check your connection and try again.') }
    finally { setExportingPdf(false) }
  }

  const table = (
    <section className={fullscreen ? 'personal-catalog-table-shell fullscreen' : 'personal-catalog-table-shell'}>
      <div className="personal-catalog-table-header">
        <div>
          <span className="eyebrow">{categoryLabel.toUpperCase()}</span>
          <h2>{categoryLabel}</h2>
        </div>
        <div className="personal-catalog-header-actions">
          <span className="personal-catalog-source">Google Sheets snapshot · MAL IDs preserved</span>
          <div className="catalog-export-wrap">
            <button className="catalog-tool-button" type="button" onClick={() => setExportOpen((value) => !value)} title="Export" aria-label="Export">⇩</button>
            {exportOpen && (
              <div className="catalog-export-menu">
                <button type="button" onClick={() => { downloadCsv(rows, categoryLabel, comments); setExportOpen(false) }}>Download CSV</button>
                <button type="button" onClick={() => { openGoogleSheet(); setExportOpen(false) }}>Open in Google Sheets</button>
                <button type="button" disabled={exportingPdf} onClick={exportPdf}>{exportingPdf ? 'Preparing PDF…' : 'Download PDF'}</button>
              </div>
            )}
          </div>
          <button className="catalog-tool-button" type="button" onClick={() => setFullscreen((value) => !value)} title={fullscreen ? 'Close fullscreen' : 'Expand'} aria-label={fullscreen ? 'Close fullscreen' : 'Expand'}>{fullscreen ? '×' : '⛶'}</button>
        </div>
      </div>

      {rows.length ? (
        <div className="personal-catalog-table-wrap">
          <table className="personal-catalog-table">
            <thead>
              <tr>
                {showRank && <th>My Ranked</th>}
                <th>Poster</th>
                <th>Anime</th>
                <th>MAL Score</th>
                <th>Original Observations</th>
                {showComments && <th>Comments</th>}
                <th className="catalog-secondary-column">Full English Name</th>
                <th className="catalog-secondary-column">Original Full Name</th>
                <th className="catalog-mal-column">MyAnimeList</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item, index) => (
                <CatalogRow
                  key={`${item.category}-${item.malId ?? item.anime}-${item.myRanked ?? index}`}
                  item={item}
                  showRank={showRank}
                  showComments={showComments}
                  comment={item.malId ? comments.get(item.malId) : undefined}
                  onOpen={() => openDetails(item)}
                  onOpenComment={() => item.malId && setEditingItem(item)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="personal-catalog-empty"><strong>No matching entries</strong><span>Try another search or switch catalog tabs.</span></div>
      )}
    </section>
  )

  return (
    <div className="page personal-catalog-page">
      {!fullscreen && (
        <>
          <section className="page-intro personal-catalog-intro">
            <span className="eyebrow">PERSONAL CATALOG</span>
            <h1>Personal Catalog</h1>
            <p>Your curated anime collection, preserving personal rankings, historical notes and editable comments.</p>
          </section>

          <div className="personal-catalog-search-row">
            <div className="personal-catalog-search">
              <span>⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search anime, title or original observations…" aria-label="Search selected personal catalog" />
              {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button>}
            </div>
            <span className="personal-catalog-count">{rows.length} {rows.length === 1 ? 'entry' : 'entries'}</span>
          </div>

          <nav className="personal-catalog-tabs" aria-label="Personal catalog categories">
            {personalCatalogCategories.map((tab) => (
              <button key={tab.id} type="button" className={category === tab.id ? 'active' : ''} onClick={() => { setCategory(tab.id); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
                {tab.label}<span>{personalCatalogRepository.list(tab.id).length}</span>
              </button>
            ))}
          </nav>
        </>
      )}

      {table}

      {editingItem?.malId && (
        <CommentEditor
          malId={editingItem.malId}
          animeTitle={editingItem.anime}
          initialComment={comments.get(editingItem.malId)}
          onClose={() => setEditingItem(null)}
          onSaved={(comment) => setComments((current) => {
            const next = new Map(current)
            next.set(comment.malId, comment)
            return next
          })}
        />
      )}
    </div>
  )
}

export default function PersonalCatalogEnhancer() {
  const location = useLocation()
  const active = location.pathname === '/app/my-anime'
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setHost(null)
    if (!active) return
    let mountedHost: HTMLDivElement | null = null
    let hiddenPage: HTMLElement | null = null

    const sync = () => {
      const main = document.querySelector('.app-shell > main') as HTMLElement | null
      if (!main) return
      hiddenPage = Array.from(main.children).find((child) => child.classList.contains('page') && !child.classList.contains('personal-catalog-host')) as HTMLElement | null
      if (hiddenPage) hiddenPage.style.display = 'none'
      const existing = main.querySelector(':scope > .personal-catalog-host') as HTMLDivElement | null
      if (existing) {
        mountedHost = existing
        setHost(existing)
        return
      }
      const nextHost = document.createElement('div')
      nextHost.className = 'personal-catalog-host'
      main.appendChild(nextHost)
      mountedHost = nextHost
      setHost(nextHost)
    }

    sync()
    const observer = new MutationObserver(sync)
    const root = document.getElementById('root')
    if (root) observer.observe(root, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (hiddenPage) hiddenPage.style.removeProperty('display')
      mountedHost?.remove()
    }
  }, [active])

  return host && active ? createPortal(<PersonalCatalogPage />, host) : null
}
