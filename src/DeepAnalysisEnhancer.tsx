import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { animeDetailsService, franchiseService, type AnimeDetailsOverview, type FranchiseResult, type NerdSection } from './animeDetails'
import { analyticsService, getPersonalAnalytics, type PersonalAnalytics } from './analytics'
import { loadNerdDataProgressive, type ProgressiveNerdSnapshot } from './nerdDataProgressive'
import { FranchiseMap, GlobalFootprintPlaceholder, ScoreTimeline } from './AnalyticsVisuals'

function findField(sections: NerdSection[], labels: string[]) {
  for (const section of sections) {
    const field = section.fields.find((entry) => labels.some((label) => entry.label.toLowerCase().includes(label.toLowerCase())))
    if (field) return field
  }
  return null
}

function valueText(value: string | string[] | number | undefined) {
  if (value == null) return 'No reliable data'
  return Array.isArray(value) ? value.join(' · ') : String(value)
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <article className="deep-stat"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>
}

function DataRow({ label, value, sourceUrl }: { label: string; value: string; sourceUrl?: string | null }) {
  return <div className="deep-data-row"><span>{label}</span><strong>{value}</strong>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">Source ↗</a>}</div>
}

function DeepAnalysisPage({ malId }: { malId: number }) {
  const navigate = useNavigate()
  const [overview, setOverview] = useState<AnimeDetailsOverview | null>(null)
  const [franchise, setFranchise] = useState<FranchiseResult | null>(null)
  const [personal, setPersonal] = useState<PersonalAnalytics | null>(null)
  const [nerd, setNerd] = useState<ProgressiveNerdSnapshot>({ state: 'idle', sections: [], completedSources: 0, totalSources: 4, failedSources: 0 })
  const [error, setError] = useState('')

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
    let live = true
    setError('')
    setOverview(null)
    setFranchise(null)
    setPersonal(null)
    setNerd({ state: 'idle', sections: [], completedSources: 0, totalSources: 4, failedSources: 0 })

    void Promise.allSettled([
      animeDetailsService.getOverview(malId),
      franchiseService.getFranchise(malId),
    ]).then(async ([overviewResult, franchiseResult]) => {
      if (!live) return
      const nextOverview = overviewResult.status === 'fulfilled' ? overviewResult.value : null
      const nextFranchise = franchiseResult.status === 'fulfilled' ? franchiseResult.value : null
      setOverview(nextOverview)
      setFranchise(nextFranchise)
      try {
        const nextPersonal = await getPersonalAnalytics(malId, nextFranchise)
        if (live) setPersonal(nextPersonal)
      } catch {
        // Personal analytics are optional on the advanced page.
      }
      if (!nextOverview) {
        setError('Could not load the selected anime for Deep Analysis.')
        return
      }
      setNerd((current) => ({ ...current, state: 'loading' }))
      void loadNerdDataProgressive(malId, nextOverview.anime, (snapshot) => {
        if (live) setNerd(snapshot)
      }).then((snapshot) => live && setNerd(snapshot)).catch((reason) => {
        if (live) setNerd({ state: 'error', sections: [], completedSources: 0, totalSources: 4, failedSources: 4, message: reason instanceof Error ? reason.message : 'Advanced metadata unavailable.' })
      })
    })

    return () => { live = false }
  }, [malId])

  const franchiseAnalytics = useMemo(() => analyticsService.calculateFranchiseAnalytics(franchise), [franchise])
  if (error) return <div className="page deep-analysis-page"><div className="notice error">{error}</div><button className="primary-button" onClick={() => navigate(`/app/anime/${malId}`)}>Back to Anime Details</button></div>
  if (!overview) return <div className="page deep-analysis-page"><div className="deep-analysis-loading"><span className="spinner" /> Loading Deep Analysis…</div></div>

  const anime = overview.anime
  const director = overview.director ?? valueText(findField(nerd.sections, ['Director'])?.datum.value)
  const creator = overview.creator ?? valueText(findField(nerd.sections, ['Original creator'])?.datum.value)
  const studio = overview.studio ?? valueText(findField(nerd.sections, ['Studio'])?.datum.value)
  const mainStaff = findField(nerd.sections, ['Key animation staff', 'Staff producers'])
  const mainCast = findField(nerd.sections, ['Japanese voice cast'])
  const streaming = findField(nerd.sections, ['streaming'])
  const licensors = findField(nerd.sections, ['Licensors'])
  const sourceTitle = overview.sourceTitle ?? 'No reliable data'

  return (
    <div className="page deep-analysis-page">
      <button className="text-button back-button" onClick={() => navigate(`/app/anime/${malId}`)}>← Anime Details</button>
      <section className="deep-analysis-hero">
        <div className="deep-analysis-poster">{anime.largeImageUrl || anime.imageUrl ? <img src={anime.largeImageUrl || anime.imageUrl!} alt={anime.title} /> : <span>No poster</span>}</div>
        <div><span className="eyebrow">ANIMEFINDER ANALYTICS V0</span><h1>{anime.title}</h1><h2>Deep Analysis</h2><p>Advanced franchise, audience and market analytics. Heavy datasets load only on this page.</p><div className="deep-personal-pill">{personal?.watched ? '✓ Watched' : 'Not watched'}{personal?.rank != null ? ` · My Rank #${personal.rank}` : ''}</div></div>
      </section>

      <section className="deep-section">
        <div className="details-v2-section-heading"><div><span className="eyebrow">01</span><h2>Franchise Analytics</h2></div></div>
        <div className="deep-stat-grid">
          <Stat label="Franchise Average" value={franchiseAnalytics.average?.toFixed(2) ?? '—'} />
          <Stat label="Highest Rated" value={franchiseAnalytics.highest ? `${franchiseAnalytics.highest.title} · ${franchiseAnalytics.highest.malScore?.toFixed(2)}` : '—'} />
          <Stat label="Lowest Rated" value={franchiseAnalytics.lowest ? `${franchiseAnalytics.lowest.title} · ${franchiseAnalytics.lowest.malScore?.toFixed(2)}` : '—'} />
          <Stat label="Score Range" value={franchiseAnalytics.scoreRange?.toFixed(2) ?? '—'} />
          <Stat label="Std. Deviation" value={franchiseAnalytics.standardDeviation?.toFixed(2) ?? '—'} />
          <Stat label="Related Works" value={String(franchiseAnalytics.totalWorks)} detail={`${franchiseAnalytics.scoredWorks} with valid MAL scores`} />
        </div>
        <div className="deep-chart-card"><h3>Chronological Score Timeline</h3><ScoreTimeline works={franchise?.works ?? []} /></div>
        <div className="deep-chart-card"><h3>Franchise Map</h3><FranchiseMap works={franchise?.works ?? []} selectedId={malId} onOpen={(id) => navigate(`/app/anime/${id}?view=analysis`)} /></div>
      </section>

      <section className="deep-section">
        <div className="details-v2-section-heading"><div><span className="eyebrow">02</span><h2>Production & People</h2></div><span className={`analytics-state ${nerd.state}`}>{nerd.state}</span></div>
        <div className="deep-data-grid">
          <DataRow label="Director" value={director} />
          <DataRow label="Original Creator" value={creator} />
          <DataRow label="Studio" value={studio} />
          <DataRow label="Main Staff" value={valueText(mainStaff?.datum.value)} sourceUrl={mainStaff?.datum.sourceUrl} />
          <DataRow label="Main Voice Cast" value={valueText(mainCast?.datum.value)} sourceUrl={mainCast?.datum.sourceUrl} />
        </div>
      </section>

      <section className="deep-section">
        <div className="details-v2-section-heading"><div><span className="eyebrow">03</span><h2>Source & Manga</h2></div></div>
        <div className="deep-data-grid">
          <DataRow label="Original source" value={sourceTitle} />
          <DataRow label="Source format" value={overview.sourceType ?? anime.source ?? 'No reliable data'} />
          <DataRow label="Publisher / Magazine" value="No reliable data" />
          <DataRow label="Volumes / Chapters" value="No reliable data" />
          <DataRow label="Copies sold" value="No reliable data" />
          <DataRow label="Circulation" value="No reliable data" />
        </div>
        <div className="anime-effect-card"><span>Anime Effect</span><strong>Historical sales data required.</strong><p>AnimeFinder will only calculate adaptation lift when reliable before/after source-sales data is connected.</p></div>
      </section>

      <section className="deep-section">
        <div className="details-v2-section-heading"><div><span className="eyebrow">04</span><h2>Audience Analytics</h2></div></div>
        <div className="deep-stat-grid">
          <Stat label="MAL Score" value={anime.score?.toFixed(2) ?? '—'} />
          <Stat label="MAL Rank" value={anime.rank != null ? `#${anime.rank}` : '—'} />
          <Stat label="Popularity Rank" value={anime.popularity != null ? `#${anime.popularity}` : '—'} />
          <Stat label="Members" value={anime.members?.toLocaleString() ?? '—'} />
          <Stat label="Favorites" value={anime.favorites?.toLocaleString() ?? '—'} />
          <Stat label="Franchise dispersion" value={franchiseAnalytics.standardDeviation?.toFixed(2) ?? '—'} detail="Standard deviation of valid related-work MAL scores" />
        </div>
      </section>

      <section className="deep-section">
        <div className="details-v2-section-heading"><div><span className="eyebrow">05</span><h2>Business & Markets</h2></div></div>
        <div className="deep-data-grid">
          <DataRow label="International licensing" value={valueText(licensors?.datum.value)} sourceUrl={licensors?.datum.sourceUrl} />
          <DataRow label="Streaming distribution" value={valueText(streaming?.datum.value)} sourceUrl={streaming?.datum.sourceUrl} />
          <DataRow label="Manga sales" value="No reliable data" />
          <DataRow label="Movie box office" value="No reliable data" />
          <DataRow label="Regional publishers" value="No reliable data" />
        </div>
      </section>

      <section className="deep-section">
        <div className="details-v2-section-heading"><div><span className="eyebrow">06</span><h2>Global Footprint</h2><p>Country-level architecture is ready, but AnimeFinder does not manufacture regional values.</p></div></div>
        <GlobalFootprintPlaceholder />
      </section>
    </div>
  )
}

export default function DeepAnalysisEnhancer() {
  const location = useLocation()
  const match = location.pathname.match(/^\/app\/anime\/(\d+)$/)
  const malId = match ? Number(match[1]) : null
  const isAnalysis = new URLSearchParams(location.search).get('view') === 'analysis'
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setHost(null)
    if (!malId || !isAnalysis) return
    let mounted: HTMLDivElement | null = null
    const hidden = new Map<HTMLElement, string>()

    const sync = () => {
      const main = document.querySelector('.app-shell > main') as HTMLElement | null
      if (!main) return
      Array.from(main.children).forEach((child) => {
        if (!(child instanceof HTMLElement) || child.classList.contains('deep-analysis-host')) return
        if (!hidden.has(child)) hidden.set(child, child.style.display)
        child.style.display = 'none'
      })
      const existing = main.querySelector(':scope > .deep-analysis-host') as HTMLDivElement | null
      if (existing) { mounted = existing; setHost(existing); return }
      const next = document.createElement('div')
      next.className = 'deep-analysis-host'
      main.appendChild(next)
      mounted = next
      setHost(next)
    }

    sync()
    const observer = new MutationObserver(sync)
    const root = document.getElementById('root')
    if (root) observer.observe(root, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      hidden.forEach((display, node) => { node.style.display = display })
      mounted?.remove()
    }
  }, [malId, isAnalysis])

  return host && malId && isAnalysis ? createPortal(<DeepAnalysisPage malId={malId} />, host) : null
}
