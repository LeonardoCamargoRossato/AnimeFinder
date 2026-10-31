import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Anime } from './types'
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
  dropped: 118098722,
  new_seasons_2026: 480971659,
  needs_classification: 1543390613,
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
  const clickable = Boolean(item.malId)

  return (
    <button
      ref={ref}
      type="button"
      className={clickable ? 'catalog-poster clickable' : 'catalog-poster'}
      onClick={clickable ? onOpen : undefined}
      disabled={!clickable}
      title={clickable ? `Open ${item.anime}` : 'No MyAnimeList ID available'}
      aria-label={clickable ? `Open ${item.anime} details` : `${item.anime} has no linked anime details`}
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
      title={expanded ? 'Collapse observation' : 'Click to read the full observation'}
    >
      {value}
    </button>
  )
}

function CatalogRow({ item, showRank, onOpen }: { item: PersonalCatalogItem; showRank: boolean; onOpen: () => void }) {
  return (
    <tr>
      {showRank && <td className="catalog-rank-cell">{item.myRanked == null ? <span className="catalog-empty">—</span> : <strong>#{item.myRanked}</strong>}</td>}
      <td className="catalog-poster-cell"><CatalogPoster item={item} onOpen={onOpen} /></td>
      <td className="catalog-anime-cell">
        <strong>{item.anime}</strong>
        <span className="catalog-mobile-alt">{item.englishName || item.originalName || '—'}</span>
      </td>
      <td className="catalog-score-cell">
        {item.malScore == null ? <span className="catalog-empty">—</span> : <span className="catalog-score">★ {item.malScore.toFixed(2)}</span>}
      </td>
      <td className="catalog-observation-cell"><ObservationCell value={item.observations} /></td>
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

function downloadCsv(rows: PersonalCatalogItem[], categoryLabel: string) {
  const header = ['My Ranked', 'Anime', 'MyAnimeList Score', 'Observations', 'Full English Name', 'Original Full Name', 'MyAnimeList Link']
  const body = rows.map((item) => [
    item.myRanked,
    item.anime,
    item.malScore,
    item.observations,
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

async function downloadPdf(rows: PersonalCatalogItem[], categoryLabel: string) {
  const moduleUrl = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm'
  const pdfModule = await import(/* @vite-ignore */ moduleUrl) as { jsPDF: new (options?: Record<string, unknown>) => any }
  const doc = new pdfModule.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageWidth = 297
  const pageHeight = 210
  const margin = 12
  const purple: [number, number, number] = [124, 92, 246]
  const navy: [number, number, number] = [15, 23, 42]
  const muted: [number, number, number] = [88, 99, 120]
  const line: [number, number, number] = [224, 228, 238]
  const columns = {
    rank: { x: 12, w: 18 },
    anime: { x: 30, w: 49 },
    score: { x: 79, w: 20 },
    observations: { x: 99, w: 77 },
    english: { x: 176, w: 42 },
    original: { x: 218, w: 45 },
    mal: { x: 263, w: 22 },
  }

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
    doc.text(`Page ${page}`, pageWidth - margin, 11, { align: 'right' })
    doc.text(`${rows.length} entries`, pageWidth - margin, 18, { align: 'right' })
  }

  const drawColumnHeader = (y: number) => {
    doc.setFillColor(245, 246, 250)
    doc.roundedRect(margin, y, pageWidth - margin * 2, 9, 1.5, 1.5, 'F')
    doc.setTextColor(...muted)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.text('RANK', columns.rank.x + 2, y + 5.6)
    doc.text('ANIME', columns.anime.x + 2, y + 5.6)
    doc.text('MAL', columns.score.x + 2, y + 5.6)
    doc.text('OBSERVATIONS', columns.observations.x + 2, y + 5.6)
    doc.text('ENGLISH NAME', columns.english.x + 2, y + 5.6)
    doc.text('ORIGINAL NAME', columns.original.x + 2, y + 5.6)
    doc.text('LINK', columns.mal.x + 2, y + 5.6)
  }

  const truncateLines = (text: string, width: number, maxLines: number) => {
    const lines = doc.splitTextToSize(text, width) as string[]
    if (lines.length <= maxLines) return lines
    const clipped = lines.slice(0, maxLines)
    clipped[maxLines - 1] = `${clipped[maxLines - 1].replace(/[.…]*$/, '')}…`
    return clipped
  }

  let page = 1
  let y = 31
  drawHeader(page)
  drawColumnHeader(y)
  y += 11

  rows.forEach((item, index) => {
    const rowHeight = 16
    if (y + rowHeight > pageHeight - 12) {
      doc.addPage()
      page += 1
      y = 31
      drawHeader(page)
      drawColumnHeader(y)
      y += 11
    }

    if (index % 2 === 0) {
      doc.setFillColor(250, 250, 253)
      doc.rect(margin, y - 2, pageWidth - margin * 2, rowHeight, 'F')
    }

    doc.setDrawColor(...line)
    doc.line(margin, y + rowHeight - 2, pageWidth - margin, y + rowHeight - 2)
    doc.setTextColor(...navy)
    doc.setFontSize(7.4)

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...purple)
    doc.text(item.myRanked == null ? '—' : `#${item.myRanked}`, columns.rank.x + 2, y + 4)

    doc.setTextColor(...navy)
    doc.setFont('helvetica', 'bold')
    doc.text(truncateLines(item.anime, columns.anime.w - 4, 2), columns.anime.x + 2, y + 4)

    doc.setFont('helvetica', 'bold')
    doc.text(item.malScore == null ? '—' : item.malScore.toFixed(2), columns.score.x + 2, y + 4)

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...muted)
    doc.text(truncateLines(item.observations ?? '—', columns.observations.w - 4, 3), columns.observations.x + 2, y + 4)
    doc.text(truncateLines(item.englishName ?? '—', columns.english.w - 4, 3), columns.english.x + 2, y + 4)
    doc.text(truncateLines(item.originalName ?? '—', columns.original.w - 4, 3), columns.original.x + 2, y + 4)

    if (item.malUrl) {
      doc.setTextColor(...purple)
      doc.textWithLink('Open MAL', columns.mal.x + 2, y + 4, { url: item.malUrl })
    } else {
      doc.setTextColor(...muted)
      doc.text('—', columns.mal.x + 2, y + 4)
    }

    y += rowHeight
  })

  const generated = new Date().toLocaleString()
  const totalPages = doc.getNumberOfPages()
  for (let i = 1; i <= totalPages; i += 1) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.8)
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
  const [exportingPdf, setExportingPdf] = useState(false)
  const rows = useMemo(() => personalCatalogRepository.search(category, query), [category, query])
  const showRank = category === 'watched'
  const restored = useRef(false)
  const categoryLabel = personalCatalogCategories.find((tab) => tab.id === category)?.label ?? 'Catalog'

  useEffect(() => {
    saveState({ category, query, scrollY: window.scrollY })
  }, [category, query])

  useEffect(() => {
    if (restored.current || saved.scrollY == null) return
    restored.current = true
    const restore = () => window.scrollTo({ top: saved.scrollY ?? 0, behavior: 'auto' })
    requestAnimationFrame(() => requestAnimationFrame(restore))
  }, [saved.scrollY, rows.length])

  useEffect(() => {
    if (!fullscreen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
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
    try {
      await downloadPdf(rows, categoryLabel)
    } catch (error) {
      console.error('Could not generate Personal Catalog PDF', error)
      window.alert('Could not generate the PDF. Please check your connection and try again.')
    } finally {
      setExportingPdf(false)
    }
  }

  return (
    <div className="page personal-catalog-page">
      <section className="page-intro personal-catalog-intro">
        <span className="eyebrow">PERSONAL CATALOG</span>
        <h1>Personal Catalog</h1>
        <p>Your curated anime collection, preserving personal rankings, notes and validated MyAnimeList references.</p>
      </section>

      <div className="personal-catalog-search-row">
        <div className="personal-catalog-search">
          <span>⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search anime, English/original title or observations…"
            aria-label="Search selected personal catalog"
          />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button>}
        </div>
        <span className="personal-catalog-count">{rows.length} {rows.length === 1 ? 'entry' : 'entries'}</span>
      </div>

      <nav className="personal-catalog-tabs" aria-label="Personal catalog categories">
        {personalCatalogCategories.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={category === tab.id ? 'active' : ''}
            onClick={() => {
              setCategory(tab.id)
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          >
            {tab.label}
            <span>{personalCatalogRepository.list(tab.id).length}</span>
          </button>
        ))}
      </nav>

      <section className={fullscreen ? 'personal-catalog-table-shell fullscreen' : 'personal-catalog-table-shell'}>
        <div className="personal-catalog-table-header">
          <div>
            <span className="eyebrow">{categoryLabel.toUpperCase()}</span>
            <h2>{categoryLabel}</h2>
          </div>
          <div className="personal-catalog-header-tools">
            <span className="personal-catalog-source">Google Sheets snapshot · MAL IDs preserved</span>
            <details className="catalog-export-menu">
              <summary className="catalog-tool-button" title="Export catalog" aria-label="Export catalog">⇩</summary>
              <div className="catalog-export-popover">
                <button type="button" onClick={() => downloadCsv(rows, categoryLabel)}>
                  <span>CSV</span>
                  <strong>Download CSV</strong>
                </button>
                <button type="button" onClick={openGoogleSheet}>
                  <span>G</span>
                  <strong>Open in Google Sheets ↗</strong>
                </button>
                <button type="button" onClick={() => void exportPdf()} disabled={exportingPdf}>
                  <span>PDF</span>
                  <strong>{exportingPdf ? 'Generating PDF…' : 'Download PDF'}</strong>
                </button>
              </div>
            </details>
            {!fullscreen ? (
              <button className="catalog-tool-button" type="button" onClick={() => setFullscreen(true)} title="Expand to full screen" aria-label="Expand catalog to full screen">⛶</button>
            ) : (
              <button className="catalog-tool-button close" type="button" onClick={() => setFullscreen(false)} title="Close full screen" aria-label="Close full screen">×</button>
            )}
          </div>
        </div>

        {rows.length ? (
          <div className="personal-catalog-table-wrap">
            <table className="personal-catalog-table">
              <thead>
                <tr>
                  {showRank && <th className="catalog-rank-column">My Ranked</th>}
                  <th className="catalog-poster-column">Poster</th>
                  <th className="catalog-anime-column">Anime</th>
                  <th className="catalog-score-column">MAL Score</th>
                  <th className="catalog-observation-column">Observations</th>
                  <th className="catalog-secondary-column catalog-english-column">Full English Name</th>
                  <th className="catalog-secondary-column catalog-original-column">Original Full Name</th>
                  <th className="catalog-mal-column">MyAnimeList</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item, index) => (
                  <CatalogRow
                    key={`${item.category}-${item.malId ?? item.anime}-${item.myRanked ?? index}`}
                    item={item}
                    showRank={showRank}
                    onOpen={() => openDetails(item)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="personal-catalog-empty">
            <strong>No matching entries</strong>
            <span>Try another search or switch catalog tabs.</span>
          </div>
        )}
      </section>
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
