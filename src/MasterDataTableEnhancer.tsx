import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { personalCatalogCategories, personalCatalogRepository, type PersonalCatalogCategory } from './personalCatalog'
import { backfillPersonalCatalogSynopsis, type SynopsisBackfillProgress } from './synopsis'
import { characterKnowledgeJson, loadMasterDataSnapshot, type MasterDataSnapshot } from './masterData'
import type { ManagedCatalogWork } from './personalCatalogManager'

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

function rowComment(snapshot: MasterDataSnapshot, work: ManagedCatalogWork) {
  if (work.primaryMalId) {
    const comment = snapshot.comments.get(work.primaryMalId)?.contentText
    if (comment) return comment
  }
  return snapshot.summaries.get(work.id)?.currentComment ?? ''
}

function genresFor(work: ManagedCatalogWork) {
  if (!work.primaryMalId) return [] as string[]
  return personalCatalogRepository.getCachedMetadata(work.primaryMalId)?.genres.map((row) => row.name) ?? []
}

function masterRow(snapshot: MasterDataSnapshot, work: ManagedCatalogWork) {
  const summary = snapshot.summaries.get(work.id)
  const synopsis = snapshot.synopsis.get(work.id)
  const characters = characterKnowledgeJson(snapshot, work.id)
  return {
    id: work.id,
    category: work.category,
    myRanked: work.myRanked,
    anime: work.displayName,
    primaryMalId: work.primaryMalId,
    malScore: work.malScore,
    originalObservations: work.originalObservations,
    comment: rowComment(snapshot, work),
    keywords: summary?.keywords ?? [],
    characters: summary?.characters ?? characters.map((row) => row.name),
    genres: genresFor(work),
    englishName: work.englishName,
    originalName: work.originalName,
    malUrl: work.malUrl,
    watchStatus: work.watchStatus,
    synopsis: {
      original: synopsis?.original ?? null,
      ptBR: synopsis?.portuguese ?? null,
      source: synopsis?.source ?? null,
      status: synopsis?.status ?? null,
      fetchedAt: synopsis?.fetchedAt ?? null,
    },
    characterKnowledge: characters,
  }
}

function exportCsv(snapshot: MasterDataSnapshot, category: PersonalCatalogCategory) {
  const works = snapshot.works.filter((work) => work.category === category)
  const header = ['My Ranked','Anime','MAL ID','MAL Score','Original Observations','Comments','Characters','Keywords','Genres','Full English Name','Original Full Name','MyAnimeList','Watch Status','MAL Synopsis','Synopsis PT-BR','Character Knowledge JSON']
  const body = works.map((work) => {
    const row = masterRow(snapshot, work)
    return [row.myRanked,row.anime,row.primaryMalId,row.malScore,row.originalObservations,row.comment,row.characters.join(' | '),row.keywords.join(' | '),row.genres.join(' | '),row.englishName,row.originalName,row.malUrl,row.watchStatus,row.synopsis.original,row.synopsis.ptBR,row.characterKnowledge].map(csvCell).join(',')
  })
  download(`AnimeFinder-Master-${category}.csv`, `\uFEFF${[header.map(csvCell).join(','), ...body].join('\n')}`, 'text/csv;charset=utf-8')
}

function buildJsonExport(snapshot: MasterDataSnapshot) {
  const categories: Record<string, ReturnType<typeof masterRow>[]> = {}
  for (const category of personalCatalogCategories) {
    categories[category.id] = snapshot.works.filter((work) => work.category === category.id).map((work) => masterRow(snapshot, work))
  }
  return {
    animeFinderExportVersion: 'personal-knowledge-v3-master-data-v1',
    exportedAt: new Date().toISOString(),
    sourceOfTruth: 'Supabase when migrated; local cache fallback otherwise',
    categories,
  }
}

function exportJson(snapshot: MasterDataSnapshot) {
  download('AnimeFinder-Personal-Catalog.json', JSON.stringify(buildJsonExport(snapshot), null, 2), 'application/json;charset=utf-8')
}

async function exportPdf(snapshot: MasterDataSnapshot, category: PersonalCatalogCategory) {
  const moduleUrl = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm'
  const pdfModule = await import(/* @vite-ignore */ moduleUrl) as { jsPDF: new (options?: Record<string, unknown>) => any }
  const doc = new pdfModule.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const label = personalCatalogCategories.find((item) => item.id === category)?.label ?? category
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text(`AnimeFinder — ${label}`, 14, 15)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  let y = 23
  for (const work of snapshot.works.filter((row) => row.category === category)) {
    const row = masterRow(snapshot, work)
    const lines = [
      `${row.myRanked ? `#${row.myRanked} · ` : ''}${row.anime}${row.malScore != null ? ` · MAL ${row.malScore.toFixed(2)}` : ''}`,
      row.comment ? `My comment: ${row.comment}` : '',
      row.keywords.length ? `Keywords: ${row.keywords.join(', ')}` : '',
      row.characters.length ? `Characters: ${row.characters.join(', ')}` : '',
      row.synopsis.ptBR ? `Synopsis PT-BR: ${row.synopsis.ptBR}` : row.synopsis.original ? `Synopsis: ${row.synopsis.original}` : '',
    ].filter(Boolean)
    for (const raw of lines) {
      const wrapped = doc.splitTextToSize(raw, 180) as string[]
      if (y + wrapped.length * 4 > 282) { doc.addPage(); y = 15 }
      doc.text(wrapped, 14, y); y += wrapped.length * 4 + 1
    }
    y += 3
  }
  doc.save(`AnimeFinder-${label.replace(/[^a-z0-9]+/gi,'-')}.pdf`)
}

function JsonViewer({ work, data, onClose }: { work: ManagedCatalogWork; data: unknown; onClose: () => void }) {
  return createPortal(<div className="master-json-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}><section className="master-json-modal"><header><div><span className="eyebrow">CHARACTER KNOWLEDGE JSON</span><h2>{work.displayName}</h2></div><button onClick={onClose}>×</button></header><pre>{JSON.stringify(data, null, 2)}</pre></section></div>, document.body)
}

function MasterTable({ onClose }: { onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<MasterDataSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState<PersonalCatalogCategory>('watched')
  const [query, setQuery] = useState('')
  const [jsonWork, setJsonWork] = useState<ManagedCatalogWork | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [backfill, setBackfill] = useState<SynopsisBackfillProgress | null>(null)
  const [backfillRunning, setBackfillRunning] = useState(false)

  async function refresh() {
    setLoading(true)
    try { setSnapshot(await loadMasterDataSnapshot()) }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])

  const rows = useMemo(() => {
    if (!snapshot) return []
    const term = query.trim().toLowerCase()
    return snapshot.works.filter((work) => work.category === category && (!term || [work.displayName,work.englishName,work.originalName,work.originalObservations].filter(Boolean).join(' ').toLowerCase().includes(term)))
  }, [snapshot, category, query])

  async function runBackfill() {
    if (backfillRunning) return
    setBackfillRunning(true)
    try {
      await backfillPersonalCatalogSynopsis((progress) => setBackfill(progress))
      await refresh()
    } finally { setBackfillRunning(false) }
  }

  const progressPercent = backfill?.total ? Math.round((backfill.processed / backfill.total) * 100) : 0

  return createPortal(<div className="master-data-backdrop"><section className="master-data-modal" role="dialog" aria-modal="true" aria-label="AnimeFinder Master Data Table">
    <header className="master-data-header"><div><span className="eyebrow">ANIMEFINDER MASTER DATA</span><h1>Master Data Table</h1><p>Complete human-readable view of the Personal Catalog. Derived JSON stays read-only; personal data remains normalized.</p></div><button className="master-data-close" onClick={onClose}>×</button></header>

    <div className="master-data-toolbar">
      <div className="master-data-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search master data…" /></div>
      <button className="ghost-button" disabled={backfillRunning} onClick={() => void runBackfill()}>{backfillRunning ? `Backfill ${progressPercent}%` : 'Backfill Synopsis'}</button>
      <div className="master-export-wrap"><button className="primary-button" onClick={() => setExportOpen((value) => !value)}>Export</button>{exportOpen && snapshot && <div className="master-export-menu"><button onClick={() => exportCsv(snapshot, category)}>Download CSV</button><button onClick={() => exportJson(snapshot)}>Download JSON</button><button onClick={() => void exportPdf(snapshot, category)}>Download PDF</button><button disabled title="Requires explicit Google Sheets write OAuth scope. Current Google login does not grant this permission.">Export to Google Sheets — not configured</button></div>}</div>
    </div>

    {backfill && <div className="master-backfill-status"><div><strong>Synopsis backfill: {backfill.processed}/{backfill.total} ({progressPercent}%)</strong><span>{backfill.currentWork ? `Processing ${backfill.currentWork}` : backfillRunning ? 'Working…' : 'Finished'}</span></div><div className="master-progress"><span style={{ width: `${progressPercent}%` }} /></div><small>{backfill.succeeded} stored · {backfill.missingSource} missing source · {backfill.failed} failed</small></div>}

    <nav className="master-data-tabs">{personalCatalogCategories.map((tab) => <button key={tab.id} className={category === tab.id ? 'active' : ''} onClick={() => setCategory(tab.id)}>{tab.label}<span>{snapshot?.works.filter((work) => work.category === tab.id).length ?? 0}</span></button>)}</nav>

    {loading && <div className="master-data-loading"><span className="spinner" /><strong>Loading cached/Supabase master data…</strong></div>}
    {!loading && snapshot && <div className="master-table-scroll"><table className="master-data-table"><thead><tr><th>My Ranked</th><th>Anime</th><th>MAL Score</th><th>Original Observations</th><th>Comments</th><th>Characters</th><th>Keywords</th><th>Genres</th><th>Full English Name</th><th>Original Full Name</th><th>MyAnimeList</th><th>Knowledge</th><th>MAL Synopsis</th><th>Synopsis PT-BR</th><th>Character Knowledge</th></tr></thead><tbody>{rows.map((work) => {
      const summary = snapshot.summaries.get(work.id)
      const synopsis = snapshot.synopsis.get(work.id)
      const characters = characterKnowledgeJson(snapshot, work.id)
      return <tr key={work.id}><td>{work.myRanked ? `#${work.myRanked}` : '—'}</td><td className="master-title"><strong>{work.displayName}</strong><small>{work.category}</small></td><td>{work.malScore == null ? '—' : `★ ${work.malScore.toFixed(2)}`}</td><td><div className="master-clamp">{work.originalObservations || '—'}</div></td><td><div className="master-clamp">{rowComment(snapshot, work) || '—'}</div></td><td><div className="master-chip-flow">{(summary?.characters ?? characters.map((row) => row.name)).slice(0,5).map((value) => <span key={value}>{value}</span>)}</div></td><td><div className="master-chip-flow">{(summary?.keywords ?? []).slice(0,7).map((value) => <span key={value}>{value}</span>)}</div></td><td><div className="master-chip-flow">{genresFor(work).slice(0,4).map((value) => <span key={value}>{value}</span>)}</div></td><td>{work.englishName || '—'}</td><td>{work.originalName || '—'}</td><td>{work.malUrl ? <a href={work.malUrl} target="_blank" rel="noreferrer">MAL ↗</a> : '—'}</td><td>{summary?.hasKnowledge ? '✓ Personal Knowledge' : '—'}</td><td><div className="master-clamp synopsis">{synopsis?.original || (synopsis?.status === 'missing_source' ? 'Missing source' : 'Not cached')}</div></td><td><div className="master-clamp synopsis">{synopsis?.portuguese || (synopsis?.original ? 'Translation pending' : '—')}</div></td><td><button className="ghost-button compact" disabled={!characters.length} onClick={() => setJsonWork(work)}>{characters.length ? `${characters.length} characters · View JSON` : 'No character data'}</button></td></tr>
    })}</tbody></table></div>}
  </section>{jsonWork && snapshot && <JsonViewer work={jsonWork} data={characterKnowledgeJson(snapshot, jsonWork.id)} onClose={() => setJsonWork(null)} />}</div>, document.body)
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
      button.type = 'button'
      button.dataset.masterDataOpen = 'true'
      button.className = 'ghost-button master-data-open-button'
      button.textContent = 'View Full Table'
      button.addEventListener('click', () => setOpen(true))
      actions.insertBefore(button, actions.firstChild)
    }
    sync()
    const observer = new MutationObserver(sync)
    const root = document.getElementById('root')
    if (root) observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [location.pathname])

  return open ? <MasterTable onClose={() => setOpen(false)} /> : null
}
