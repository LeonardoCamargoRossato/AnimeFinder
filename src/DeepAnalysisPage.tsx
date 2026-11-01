import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { animeProvider } from './providers'
import type { Anime } from './types'
import { franchiseService, type FranchiseResult, type NerdSection } from './animeDetails'
import { analyticsService } from './analytics'
import { loadNerdDataProgressive, type ProgressiveNerdSnapshot } from './nerdDataProgressive'

function valueText(value: string | string[] | number | undefined) {
  if (value == null) return 'No reliable data'
  return Array.isArray(value) ? value.join(' · ') : String(value)
}

function findField(sections: NerdSection[], labels: string[]) {
  for (const section of sections) {
    const field = section.fields.find((entry) => labels.some((label) => entry.label.toLowerCase().includes(label.toLowerCase())))
    if (field) return field
  }
  return null
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <article className="deep-stat"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>
}

function DataRow({ label, value, sourceUrl }: { label: string; value: string; sourceUrl?: string | null }) {
  return <div className="deep-data-row"><span>{label}</span><strong>{value}</strong>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">Source ↗</a>}</div>
}

function AdvancedLoading({ snapshot }: { snapshot: ProgressiveNerdSnapshot }) {
  const percentage = snapshot.totalSources > 0 ? Math.round((snapshot.completedSources / snapshot.totalSources) * 100) : 0
  return (
    <div className="deep-progress-panel" role="status" aria-live="polite">
      <div><span className="spinner" /><strong>Loading advanced metadata… {percentage}%</strong></div>
      <div className="deep-progress-track"><span style={{ width: `${Math.max(8, percentage)}%` }} /></div>
      <small>{snapshot.completedSources}/{snapshot.totalSources} sources completed{snapshot.failedSources ? ` · ${snapshot.failedSources} unavailable` : ''}</small>
    </div>
  )
}

function GenerateVisualization({
  title,
  description,
  onGenerate,
  children,
}: {
  title: string
  description: string
  onGenerate: () => Promise<void>
  children: React.ReactNode
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  async function generate() {
    setState('loading')
    try {
      await onGenerate()
      setState('ready')
    } catch {
      setState('error')
    }
  }
  return (
    <div className="deep-chart-card deferred-chart-card">
      <div className="deferred-chart-heading"><div><h3>{title}</h3><p>{description}</p></div>{state !== 'ready' && <button className="ghost-button" disabled={state === 'loading'} onClick={generate}>{state === 'loading' ? 'Generating…' : state === 'error' ? 'Retry' : 'Generate chart'}</button>}</div>
      {state === 'loading' && <div className="deferred-loading"><div className="deferred-loading-row"><span className="spinner" /><strong>Loading visualization module…</strong></div><div className="deferred-progress"><span /></div></div>}
      {state === 'error' && <div className="notice error">Could not generate this visualization.</div>}
      {state === 'ready' && children}
    </div>
  )
}

function GlobalFootprintPlaceholder() {
  return <div className="global-footprint-placeholder"><strong>No reliable country-level dataset connected yet.</strong><p>Future layers: Popularity · Distribution · Streaming · Publishing · Box Office · Search Interest.</p><small>No Data is never interpreted as zero popularity.</small></div>
}

export default function DeepAnalysisPage({ malId }: { malId: number }) {
  const navigate = useNavigate()
  const [anime, setAnime] = useState<Anime | null>(null)
  const [franchise, setFranchise] = useState<FranchiseResult | null>(null)
  const [error, setError] = useState('')
  const [advancedRequested, setAdvancedRequested] = useState(false)
  const [nerd, setNerd] = useState<ProgressiveNerdSnapshot>({ state: 'idle', sections: [], completedSources: 0, totalSources: 4, failedSources: 0 })
  const [Timeline, setTimeline] = useState<ComponentType<any> | null>(null)
  const [MapView, setMapView] = useState<ComponentType<any> | null>(null)

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
    let live = true
    setAnime(null)
    setFranchise(null)
    setError('')
    setAdvancedRequested(false)
    setNerd({ state: 'idle', sections: [], completedSources: 0, totalSources: 4, failedSources: 0 })

    void animeProvider.getAnime(malId)
      .then((result) => {
        if (!live) return
        setAnime(result)
        void franchiseService.getFranchise(malId)
          .then((next) => { if (live) setFranchise(next) })
          .catch(() => { /* Franchise analytics may remain partial. */ })
      })
      .catch((reason) => { if (live) setError(reason instanceof Error ? reason.message : 'Could not load Deep Analysis.') })

    return () => { live = false }
  }, [malId])

  async function loadAdvanced() {
    if (!anime) return
    setAdvancedRequested(true)
    setNerd((current) => ({ ...current, state: 'loading' }))
    try {
      const final = await loadNerdDataProgressive(malId, anime, setNerd)
      setNerd(final)
    } catch (reason) {
      setNerd({ state: 'error', sections: [], completedSources: 0, totalSources: 4, failedSources: 4, message: reason instanceof Error ? reason.message : 'Advanced metadata unavailable.' })
    }
  }

  async function loadTimelineModule() {
    if (Timeline) return
    const module = await import('./AnalyticsVisuals')
    setTimeline(() => module.ScoreTimeline)
  }

  async function loadMapModule() {
    if (MapView) return
    const module = await import('./AnalyticsVisuals')
    setMapView(() => module.FranchiseMap)
  }

  const franchiseAnalytics = useMemo(() => analyticsService.calculateFranchiseAnalytics(franchise), [franchise])

  if (error) return <div className="page deep-analysis-page"><div className="notice error">{error}</div><button className="primary-button" onClick={() => navigate(`/app/anime/${malId}`)}>Back to Anime Details</button></div>
  if (!anime) return <div className="page deep-analysis-page"><div className="details-basic-loading"><span className="spinner" /><div><strong>Loading Deep Analysis…</strong><small>The advanced module was loaded only after your click.</small></div></div></div>

  const director = findField(nerd.sections, ['Director'])
  const creator = findField(nerd.sections, ['Original creator'])
  const mainStaff = findField(nerd.sections, ['Key animation staff', 'Staff producers'])
  const mainCast = findField(nerd.sections, ['Japanese voice cast'])
  const streaming = findField(nerd.sections, ['streaming'])
  const licensors = findField(nerd.sections, ['Licensors'])
  const sourceTitle = findField(nerd.sections, ['Manga / Light Novel title'])

  return (
    <div className="page deep-analysis-page">
      <button className="text-button back-button" onClick={() => navigate(`/app/anime/${malId}`)}>← Anime Details</button>
      <section className="deep-analysis-hero">
        <div className="deep-analysis-poster">{anime.largeImageUrl || anime.imageUrl ? <img src={anime.largeImageUrl || anime.imageUrl!} alt={anime.title} /> : <span>No poster</span>}</div>
        <div><span className="eyebrow">ANIMEFINDER</span><h1>{anime.title}</h1><h2>Deep Analysis</h2><p>Advanced franchise, people, audience and market analysis. Heavy metadata and every visualization are opt-in.</p></div>
      </section>

      <section className="deep-section">
        <div className="details-v2-section-heading"><div><span className="eyebrow">01</span><h2>Franchise Analytics</h2><p>Structured franchise calculations load only inside Deep Analysis.</p></div></div>
        <div className="deep-stat-grid">
          <Stat label="Franchise Average" value={franchiseAnalytics.average?.toFixed(2) ?? 'Loading / No data'} />
          <Stat label="Highest Rated" value={franchiseAnalytics.highest ? `${franchiseAnalytics.highest.title} · ${franchiseAnalytics.highest.malScore?.toFixed(2)}` : '—'} />
          <Stat label="Lowest Rated" value={franchiseAnalytics.lowest ? `${franchiseAnalytics.lowest.title} · ${franchiseAnalytics.lowest.malScore?.toFixed(2)}` : '—'} />
          <Stat label="Score Range" value={franchiseAnalytics.scoreRange?.toFixed(2) ?? '—'} />
          <Stat label="Std. Deviation" value={franchiseAnalytics.standardDeviation?.toFixed(2) ?? '—'} />
          <Stat label="Related Works" value={String(franchiseAnalytics.totalWorks)} detail={`${franchiseAnalytics.scoredWorks} with valid scores`} />
        </div>

        <GenerateVisualization title="Chronological Score Timeline" description="Nothing is rendered until you explicitly generate this chart." onGenerate={loadTimelineModule}>
          {Timeline && <Timeline works={franchise?.works ?? []} />}
        </GenerateVisualization>
        <GenerateVisualization title="Franchise Map" description="The relationship visualization is generated only on demand." onGenerate={loadMapModule}>
          {MapView && <MapView works={franchise?.works ?? []} selectedId={malId} onOpen={(id: number) => navigate(`/app/anime/${id}?view=analysis`)} />}
        </GenerateVisualization>
      </section>

      <section className="deep-section">
        <div className="details-v2-section-heading"><div><span className="eyebrow">02</span><h2>Production & People</h2><p>Staff and voice-cast endpoints are not called until you press Load.</p></div>{!advancedRequested && <button className="ghost-button" onClick={loadAdvanced}>Load</button>}</div>
        {advancedRequested && nerd.state === 'loading' && <AdvancedLoading snapshot={nerd} />}
        {advancedRequested && nerd.message && <div className={nerd.state === 'error' ? 'notice error' : 'notice'}>{nerd.message}</div>}
        {advancedRequested && nerd.state !== 'loading' && <div className="deep-data-grid"><DataRow label="Director" value={valueText(director?.datum.value)} sourceUrl={director?.datum.sourceUrl} /><DataRow label="Original Creator" value={valueText(creator?.datum.value)} sourceUrl={creator?.datum.sourceUrl} /><DataRow label="Studio" value={anime.studios?.map((entry) => entry.name).join(' · ') || 'No reliable data'} /><DataRow label="Main Staff" value={valueText(mainStaff?.datum.value)} sourceUrl={mainStaff?.datum.sourceUrl} /><DataRow label="Main Voice Cast" value={valueText(mainCast?.datum.value)} sourceUrl={mainCast?.datum.sourceUrl} /></div>}
        {!advancedRequested && <div className="analytics-no-data">Not loaded. Press Load to query staff and voice-cast sources.</div>}
      </section>

      <section className="deep-section">
        <div className="details-v2-section-heading"><div><span className="eyebrow">03</span><h2>Source & Manga</h2></div></div>
        <div className="deep-data-grid"><DataRow label="Source format" value={anime.source ?? 'No reliable data'} /><DataRow label="Original source title" value={advancedRequested ? valueText(sourceTitle?.datum.value) : 'Load Production & People to query source relations'} /><DataRow label="Publisher / Magazine" value="No reliable data" /><DataRow label="Volumes / Chapters" value="No reliable data" /><DataRow label="Copies sold" value="No reliable data" /><DataRow label="Circulation" value="No reliable data" /></div>
        <div className="anime-effect-card"><span>Anime Effect</span><strong>Historical sales data required.</strong><p>No adaptation-lift metric is calculated without reliable before/after sales data.</p></div>
      </section>

      <section className="deep-section">
        <div className="details-v2-section-heading"><div><span className="eyebrow">04</span><h2>Audience Analytics</h2></div></div>
        <div className="deep-stat-grid"><Stat label="MAL Score" value={anime.score?.toFixed(2) ?? '—'} /><Stat label="MAL Rank" value={anime.rank != null ? `#${anime.rank}` : '—'} /><Stat label="Popularity Rank" value={anime.popularity != null ? `#${anime.popularity}` : '—'} /><Stat label="Members" value={anime.members?.toLocaleString() ?? '—'} /><Stat label="Favorites" value={anime.favorites?.toLocaleString() ?? '—'} /><Stat label="Franchise dispersion" value={franchiseAnalytics.standardDeviation?.toFixed(2) ?? '—'} /></div>
      </section>

      <section className="deep-section">
        <div className="details-v2-section-heading"><div><span className="eyebrow">05</span><h2>Business & Markets</h2><p>Distribution endpoints share the same explicit advanced-data load.</p></div>{!advancedRequested && <button className="ghost-button" onClick={loadAdvanced}>Load</button>}</div>
        {advancedRequested && nerd.state === 'loading' ? <AdvancedLoading snapshot={nerd} /> : advancedRequested ? <div className="deep-data-grid"><DataRow label="International licensing" value={valueText(licensors?.datum.value)} sourceUrl={licensors?.datum.sourceUrl} /><DataRow label="Streaming distribution" value={valueText(streaming?.datum.value)} sourceUrl={streaming?.datum.sourceUrl} /><DataRow label="Manga sales" value="No reliable data" /><DataRow label="Movie box office" value="No reliable data" /></div> : <div className="analytics-no-data">Not loaded. Press Load to query available distribution sources.</div>}
      </section>

      <section className="deep-section"><div className="details-v2-section-heading"><div><span className="eyebrow">06</span><h2>Global Footprint</h2><p>Country-level data remains disabled until a reliable regional source is connected.</p></div></div><GlobalFootprintPlaceholder /></section>
    </div>
  )
}
