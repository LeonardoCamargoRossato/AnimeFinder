import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { personalCatalogCategories, type PersonalCatalogCategory } from './personalCatalog'
import { backfillPersonalCatalogSynopsis, type SynopsisBackfillProgress } from './synopsis'
import {
  auditCatalogIntegrity,
  backfillPersistedGenres,
  characterKnowledgeJson,
  loadMasterDataSnapshot,
  syncMissingCatalogWorksToSupabase,
  type CatalogIntegrityAudit,
  type MasterDataSnapshot,
  type MasterDataWork,
  type MetadataBackfillProgress,
} from './masterData'

const PORTFOLIO_URL = 'https://leonardocamargorossato.github.io/LCR-SolutionsArchitecture-IA-Quantum/#/'

function csvCell(value: unknown) {
  const text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)
  return `"${text.replace(/"/g, '""')}"`
}

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

function exportRows(snapshot: MasterDataSnapshot, category: PersonalCatalogCategory, visible?: MasterDataWork[]) {
  return visible ?? snapshot.works.filter((work) => work.category === category)
}

function exportCsv(snapshot: MasterDataSnapshot, category: PersonalCatalogCategory, visible?: MasterDataWork[]) {
  const works = exportRows(snapshot, category, visible)
  const header = ['My Ranked','Anime','MAL ID','MAL Score','Original Observations','Comments','Characters','Keywords','Genres','Full English Name','Original Full Name','MyAnimeList','Watch Status','MAL Synopsis','Synopsis PT-BR','Character Knowledge JSON']
  const body = works.map((work) => [
    work.myRanked,
    work.displayName,
    work.primaryMalId,
    work.malScore,
    work.originalObservations,
    work.comment,
    work.characterKnowledge.map((row) => row.name).join(' | '),
    work.keywords.join(' | '),
    work.genres.join(' | '),
    work.englishName,
    work.originalName,
    work.malUrl,
    work.watchStatus,
    work.synopsis.original,
    work.synopsis.ptBR,
    work.characterKnowledge,
  ].map(csvCell).join(','))
  download(`AnimeFinder-Master-${category}.csv`, `\uFEFF${[header.map(csvCell).join(','), ...body].join('\n')}`, 'text/csv;charset=utf-8')
}

function buildJsonExport(snapshot: MasterDataSnapshot) {
  const categories: Record<string, MasterDataWork[]> = {}
  for (const category of personalCatalogCategories) categories[category.id] = snapshot.works.filter((work) => work.category === category.id)
  return {
    animeFinderExportVersion: 'data-integrity-master-v4',
    exportedAt: new Date().toISOString(),
    sourceOfTruth: 'Supabase',
    totalWorks: snapshot.totalWorks,
    categoryCounts: snapshot.categoryCounts,
    categories,
  }
}

function exportJson(snapshot: MasterDataSnapshot) {
  download('AnimeFinder-Personal-Catalog.json', JSON.stringify(buildJsonExport(snapshot), null, 2), 'application/json;charset=utf-8')
}

function compact(value: string | null | undefined, max = 180) {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

async function exportPdf(snapshot: MasterDataSnapshot, category: PersonalCatalogCategory, visible?: MasterDataWork[]) {
  const moduleUrl = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm'
  const pdfModule = await import(/* @vite-ignore */ moduleUrl) as { jsPDF: new (options?: Record<string, unknown>) => any }
  const doc = new pdfModule.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const label = personalCatalogCategories.find((item) => item.id === category)?.label ?? category
  const rows = exportRows(snapshot, category, visible)
  const pageWidth = 297
  const pageHeight = 210
  const margin = 9
  const widths = [14, 51, 17, 42, 51, 94]
  const headers = ['Rank', 'Anime', 'MAL', 'Genres', 'Comment', 'Synopsis PT-BR']
  const lineHeight = 3.4
  const rowPadding = 2

  const drawHeader = () => {
    doc.setFillColor(102, 51, 153)
    doc.rect(0, 0, pageWidth, 14, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
    doc.text('AnimeFinder · Master Data Table', margin, 8)
    doc.setFontSize(8); doc.text(label, pageWidth - margin, 8, { align: 'right' })
    doc.setTextColor(25, 25, 28)
  }

  const drawTableHeader = (y: number) => {
    doc.setFillColor(239, 234, 246)
    doc.rect(margin, y, widths.reduce((sum, value) => sum + value, 0), 8, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7)
    let x = margin
    headers.forEach((header, index) => { doc.rect(x, y, widths[index], 8); doc.text(header, x + 1.5, y + 5); x += widths[index] })
    return y + 8
  }

  drawHeader()
  let y = drawTableHeader(18)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.4)

  rows.forEach((work, index) => {
    const values = [
      work.myRanked ? `#${work.myRanked}` : '—',
      work.displayName,
      work.malScore == null ? '—' : work.malScore.toFixed(2),
      work.genres.join(', ') || '—',
      compact(work.comment, 220) || '—',
      compact(work.synopsis.ptBR ?? work.synopsis.original, 380) || '—',
    ]
    const wrapped = values.map((value, column) => doc.splitTextToSize(value, widths[column] - 3) as string[])
    const rowHeight = Math.max(8, Math.min(25, Math.max(...wrapped.map((lines) => lines.length)) * lineHeight + rowPadding * 2))
    if (y + rowHeight > pageHeight - 17) {
      doc.addPage(); drawHeader(); y = drawTableHeader(18)
    }
    if (index % 2 === 1) { doc.setFillColor(249, 247, 252); doc.rect(margin, y, widths.reduce((sum, value) => sum + value, 0), rowHeight, 'F') }
    let x = margin
    wrapped.forEach((lines, column) => {
      doc.rect(x, y, widths[column], rowHeight)
      doc.text(lines.slice(0, Math.max(1, Math.floor((rowHeight - 3) / lineHeight))), x + 1.5, y + 4)
      x += widths[column]
    })
    y += rowHeight
  })

  const pageCount = doc.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page)
    doc.setDrawColor(102, 51, 153); doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12)
    doc.setFontSize(6.5); doc.setTextColor(80, 80, 85)
    doc.text('Created by Leonardo Camargo Rossato · LCR Solutions Architecture — IA & Quantum', margin, pageHeight - 7)
    if (typeof doc.textWithLink === 'function') doc.textWithLink('Portfolio', 108, pageHeight - 7, { url: PORTFOLIO_URL })
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 7, { align: 'right' })
  }
  doc.save(`AnimeFinder-${label.replace(/[^a-z0-9]+/gi,'-')}.pdf`)
}

function printTable(category: PersonalCatalogCategory, rows: MasterDataWork[]) {
  const label = personalCatalogCategories.find((item) => item.id === category)?.label ?? category
  const target = window.open('', '_blank', 'noopener,noreferrer')
  if (!target) return
  const body = rows.map((work) => `<tr><td>${work.myRanked ?? '—'}</td><td>${work.displayName}</td><td>${work.malScore ?? '—'}</td><td>${work.genres.join(', ') || '—'}</td><td>${compact(work.comment, 260) || '—'}</td><td>${compact(work.synopsis.ptBR ?? work.synopsis.original, 420) || '—'}</td></tr>`).join('')
  target.document.write(`<!doctype html><html><head><title>AnimeFinder — ${label}</title><style>@page{size:A4 landscape;margin:12mm}body{font:11px Arial,sans-serif;color:#18151d}h1{color:#663399}table{width:100%;border-collapse:collapse}th,td{border:1px solid #aaa;padding:5px;vertical-align:top}th{background:#eee7f5;text-align:left}tr:nth-child(even){background:#faf8fc}footer{margin-top:14px;border-top:2px solid #663399;padding-top:8px}</style></head><body><h1>AnimeFinder · Master Data Table</h1><h3>${label}</h3><table><thead><tr><th>Rank</th><th>Anime</th><th>MAL</th><th>Genres</th><th>Comment</th><th>Synopsis PT-BR</th></tr></thead><tbody>${body}</tbody></table><footer>Created by Leonardo Camargo Rossato · LCR Solutions Architecture — IA & Quantum · <a href="${PORTFOLIO_URL}">Portfolio</a></footer></body></html>`)
  target.document.close(); target.focus(); target.print()
}

function JsonViewer({ work, onClose }: { work: MasterDataWork; onClose: () => void }) {
  return createPortal(<div className="master-json-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}><section className="master-json-modal"><header><div><span className="eyebrow">CHARACTER KNOWLEDGE JSON</span><h2>{work.displayName}</h2></div><button onClick={onClose}>×</button></header><pre>{JSON.stringify(work.characterKnowledge, null, 2)}</pre></section></div>, document.body)
}

function MasterTable({ onClose }: { onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<MasterDataSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [category, setCategory] = useState<PersonalCatalogCategory>('watched')
  const [query, setQuery] = useState('')
  const [jsonWork, setJsonWork] = useState<MasterDataWork | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [backfill, setBackfill] = useState<SynopsisBackfillProgress | null>(null)
  const [backfillRunning, setBackfillRunning] = useState(false)
  const [metadataBackfill, setMetadataBackfill] = useState<MetadataBackfillProgress | null>(null)
  const [metadataRunning, setMetadataRunning] = useState(false)
  const [integrity, setIntegrity] = useState<CatalogIntegrityAudit | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')

  async function refresh() {
    setLoading(true); setLoadError('')
    try {
      const next = await loadMasterDataSnapshot()
      setSnapshot(next)
      setIntegrity(auditCatalogIntegrity(next))
    } catch (error) {
      setSnapshot(null)
      setIntegrity(null)
      setLoadError(error instanceof Error ? error.message : 'Could not load Supabase Master Data.')
    } finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])

  const rows = useMemo(() => {
    if (!snapshot) return []
    const term = query.trim().toLowerCase()
    return snapshot.works.filter((work) => work.category === category && (!term || [work.displayName, work.englishName, work.originalName, work.originalObservations, work.comment, ...work.keywords, ...work.genres].filter(Boolean).join(' ').toLowerCase().includes(term)))
  }, [snapshot, category, query])

  const categoryTotal = snapshot?.categoryCounts[category] ?? snapshot?.works.filter((work) => work.category === category).length ?? 0
  const renderedCategoryTotal = snapshot?.works.filter((work) => work.category === category).length ?? 0
  const categoryCountMismatch = Boolean(snapshot && categoryTotal !== renderedCategoryTotal)

  async function runBackfill() {
    if (backfillRunning) return
    setBackfillRunning(true)
    try { await backfillPersonalCatalogSynopsis((progress) => setBackfill(progress)); await refresh() }
    finally { setBackfillRunning(false) }
  }

  async function runMetadataBackfill() {
    if (metadataRunning || !snapshot) return
    setMetadataRunning(true)
    try { await backfillPersistedGenres(snapshot, (progress) => setMetadataBackfill(progress)); await refresh() }
    finally { setMetadataRunning(false) }
  }

  async function syncMissing() {
    if (!snapshot || syncing) return
    setSyncing(true); setSyncMessage('')
    try {
      const inserted = await syncMissingCatalogWorksToSupabase(snapshot)
      setSyncMessage(inserted ? `${inserted} missing Personal Works inserted into Supabase.` : 'Supabase already contains every frontend reference work.')
      await refresh()
    } catch (error) { setSyncMessage(error instanceof Error ? error.message : 'Catalog sync failed.') }
    finally { setSyncing(false) }
  }

  const progressPercent = backfill?.total ? Math.round(((backfill.alreadyCached + backfill.processed) / backfill.total) * 100) : 0
  const metadataPercent = metadataBackfill?.total ? Math.round(((metadataBackfill.alreadyPersisted + metadataBackfill.processed) / metadataBackfill.total) * 100) : 0

  return createPortal(<div className="master-data-backdrop"><section className="master-data-modal" role="dialog" aria-modal="true" aria-label="AnimeFinder Master Data Table">
    <header className="master-data-header"><div><span className="eyebrow">ANIMEFINDER MASTER DATA · SUPABASE</span><h1>Master Data Table</h1><p>Human-readable database view. Jikan/Fandom are enrichment providers; persisted Supabase data is rendered here.</p></div><button className="master-data-close" onClick={onClose}>×</button></header>

    {loadError && <div className="notice error"><strong>Master Data unavailable</strong><span>{loadError}</span></div>}
    {integrity && integrity.missingInDatabase.length > 0 && <div className="notice error"><strong>Data integrity gap: {integrity.missingInDatabase.length} frontend Personal Works are absent from Supabase.</strong><span>Master Data will not silently fill them from localStorage/hardcoded data.</span><button className="primary-button compact" disabled={syncing} onClick={() => void syncMissing()}>{syncing ? 'Syncing…' : 'Insert missing works into Supabase'}</button></div>}
    {syncMessage && <div className="catalog-save-message">{syncMessage}</div>}

    <div className="master-data-toolbar">
      <div className="master-data-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Supabase master data…" /></div>
      <button className="ghost-button" disabled={backfillRunning || !snapshot} onClick={() => void runBackfill()}>{backfillRunning ? `Synopsis ${progressPercent}%` : 'Backfill Synopsis'}</button>
      <button className="ghost-button" disabled={metadataRunning || !snapshot} onClick={() => void runMetadataBackfill()}>{metadataRunning ? `Genres ${metadataPercent}%` : 'Backfill Genres'}</button>
      <div className="master-export-wrap"><button className="primary-button" disabled={!snapshot} onClick={() => setExportOpen((value) => !value)}>Export</button>{exportOpen && snapshot && <div className="master-export-menu"><button onClick={() => exportCsv(snapshot, category, rows)}>CSV — current view</button><button onClick={() => exportCsv(snapshot, category)}>CSV — full category</button><button onClick={() => exportJson(snapshot)}>Download JSON</button><button onClick={() => void exportPdf(snapshot, category, rows)}>PDF — current view</button><button onClick={() => void exportPdf(snapshot, category)}>PDF — full category</button><button onClick={() => printTable(category, rows)}>Print current view</button><button disabled title="Requires explicit Google Sheets write OAuth scope. Current Supabase Google login does not grant this permission.">Google Sheets — OAuth scope required</button></div>}</div>
    </div>

    {backfill && <div className="master-backfill-status"><div><strong>Synopsis Backfill · {backfill.alreadyCached + backfill.processed}/{backfill.total} ({progressPercent}%)</strong><span>{backfill.currentWork ? `Processing ${backfill.currentWork}` : backfillRunning ? 'Working…' : 'Finished'}</span></div><div className="master-progress"><span style={{ width: `${progressPercent}%` }} /></div><small>{backfill.alreadyCached} already cached · {backfill.succeeded} succeeded · {backfill.missingSource} missing source · {backfill.failed} failed</small></div>}
    {metadataBackfill && <div className="master-backfill-status"><div><strong>Genres Backfill · {metadataBackfill.alreadyPersisted + metadataBackfill.processed}/{metadataBackfill.total} ({metadataPercent}%)</strong><span>{metadataBackfill.currentWork ? `Processing ${metadataBackfill.currentWork}` : metadataRunning ? 'Working…' : 'Finished'}</span></div><div className="master-progress"><span style={{ width: `${metadataPercent}%` }} /></div><small>{metadataBackfill.alreadyPersisted} already persisted · {metadataBackfill.succeeded} succeeded · {metadataBackfill.missingSource} missing source · {metadataBackfill.failed} failed</small></div>}

    <nav className="master-data-tabs">{personalCatalogCategories.map((tab) => <button key={tab.id} className={category === tab.id ? 'active' : ''} onClick={() => setCategory(tab.id)}>{tab.label}<span>{snapshot?.categoryCounts[tab.id] ?? 0}</span></button>)}</nav>

    {snapshot && <div className="master-integrity-strip"><span>Database: <strong>{snapshot.totalWorks}</strong> works</span><span>Category DB count: <strong>{categoryTotal}</strong></span><span>Master rows: <strong>{renderedCategoryTotal}</strong></span><span className={categoryCountMismatch ? 'bad' : 'good'}>{categoryCountMismatch ? '⚠ Count mismatch' : '✓ Count verified'}</span></div>}

    {loading && <div className="master-data-loading"><span className="spinner" /><strong>Loading one aggregated Supabase snapshot…</strong></div>}
    {!loading && snapshot && <div className="master-table-scroll"><table className="master-data-table"><thead><tr><th>My Ranked</th><th>Anime</th><th>MAL Score</th><th>Original Observations</th><th>Comments</th><th>Characters</th><th>Keywords</th><th>Genres</th><th>Full English Name</th><th>Original Full Name</th><th>MyAnimeList</th><th>Knowledge</th><th>MAL Synopsis</th><th>Synopsis PT-BR</th><th>Character Knowledge</th></tr></thead><tbody>{rows.map((work) => <tr key={work.id}>
      <td>{work.myRanked ? `#${work.myRanked}` : '—'}</td>
      <td className="master-title"><strong>{work.displayName}</strong><small>{work.category}</small></td>
      <td>{work.malScore == null ? '—' : `★ ${work.malScore.toFixed(2)}`}</td>
      <td><div className="master-clamp">{work.originalObservations || '—'}</div></td>
      <td><div className="master-clamp">{work.comment || '—'}</div></td>
      <td><div className="master-chip-flow">{work.characterKnowledge.slice(0, 5).map((character) => <span key={`${character.rank}-${character.name}`}>{character.name}</span>)}</div></td>
      <td><div className="master-chip-flow">{work.keywords.slice(0, 7).map((value) => <span key={value}>{value}</span>)}</div></td>
      <td><div className="master-chip-flow">{work.genres.slice(0, 4).map((value) => <span key={value}>{value}</span>)}</div></td>
      <td>{work.englishName || '—'}</td><td>{work.originalName || '—'}</td>
      <td>{work.malUrl ? <a href={work.malUrl} target="_blank" rel="noreferrer">MAL ↗</a> : '—'}</td>
      <td>{work.audit.hasPersonalComment || work.audit.hasKeywords || work.audit.hasCharacters ? '✓ Personal Knowledge' : '—'}</td>
      <td><div className="master-clamp synopsis">{work.synopsis.original || (work.synopsis.status === 'missing_source' ? 'Missing source' : 'Not persisted')}</div></td>
      <td><div className="master-clamp synopsis">{work.synopsis.ptBR || (work.synopsis.original ? 'Translation pending' : '—')}</div></td>
      <td><button className="ghost-button compact" disabled={!work.characterKnowledge.length} onClick={() => setJsonWork(work)}>{work.characterKnowledge.length ? `${work.characterKnowledge.length} characters · View JSON` : 'No character data'}</button></td>
    </tr>)}</tbody></table></div>}
  </section>{jsonWork && <JsonViewer work={jsonWork} onClose={() => setJsonWork(null)} />}</div>, document.body)
}

export default function MasterDataTableEnhancer() {
  const location = useLocation()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (location.pathname !== '/app/my-anime') { setOpen(false); return }
    const sync = () => {
      const shell = document.querySelector('.catalog-v2-shell.fullscreen') as HTMLElement | null
      const actions = shell?.querySelector('.catalog-manager-actions') as HTMLElement | null
      if (!actions || actions.querySelector('[data-master-data-open]')) return
      const button = document.createElement('button')
      button.type = 'button'; button.dataset.masterDataOpen = 'true'; button.className = 'ghost-button master-data-open-button'; button.textContent = 'View Full Table'
      button.addEventListener('click', () => setOpen(true)); actions.insertBefore(button, actions.firstChild)
    }
    sync()
    const observer = new MutationObserver(sync)
    const root = document.getElementById('root')
    if (root) observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [location.pathname])

  return open ? <MasterTable onClose={() => setOpen(false)} /> : null
}
