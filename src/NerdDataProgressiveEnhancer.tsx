import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { animeProvider } from './providers'
import { animeDetailsService, franchiseService, type AnimeDetailsOverview, type FranchiseResult, type NerdField } from './animeDetails'
import { analyticsService, type MetricState } from './analytics'
import { ScoreTimeline } from './AnalyticsVisuals'
import { loadNerdDataProgressive, type ProgressiveNerdSnapshot } from './nerdDataProgressive'
import './nerd-progressive.css'

interface Indicator {
  label: string
  state: MetricState
  value: string
  sourceUrl?: string | null
}

function textValue(field: NerdField | null | undefined) {
  if (!field) return null
  const value = field.datum.value
  return Array.isArray(value) ? value.join(' · ') : String(value)
}

function findField(snapshot: ProgressiveNerdSnapshot, labels: string[]) {
  for (const section of snapshot.sections) {
    const field = section.fields.find((entry) => labels.some((label) => entry.label.toLowerCase().includes(label.toLowerCase())))
    if (field) return field
  }
  return null
}

function available(label: string, value: string | null | undefined, sourceUrl?: string | null, partial = false): Indicator {
  return value
    ? { label, state: partial ? 'partial' : 'available', value, sourceUrl }
    : { label, state: 'unavailable', value: 'No reliable data' }
}

function unavailable(label: string, value = 'No reliable data'): Indicator {
  return { label, state: 'unavailable', value }
}

function IndicatorGroup({ title, indicators }: { title: string; indicators: Indicator[] }) {
  return (
    <article className="nerd-indicator-group">
      <h3>{title}</h3>
      <div className="nerd-indicator-list">
        {indicators.map((indicator) => (
          <div className="nerd-indicator" key={indicator.label} data-state={indicator.state}>
            <div><span>{indicator.label}</span><small className={`nerd-indicator-state ${indicator.state}`}>{indicator.state}</small></div>
            <strong>{indicator.value}</strong>
            {indicator.sourceUrl && <a href={indicator.sourceUrl} target="_blank" rel="noreferrer">ⓘ Source</a>}
          </div>
        ))}
      </div>
    </article>
  )
}

function NerdDashboard({ malId }: { malId: number }) {
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState<ProgressiveNerdSnapshot>({ state: 'idle', sections: [], completedSources: 0, totalSources: 4, failedSources: 0 })
  const [overview, setOverview] = useState<AnimeDetailsOverview | null>(null)
  const [franchise, setFranchise] = useState<FranchiseResult | null>(null)

  useEffect(() => {
    let live = true
    let finished = false
    const outerTimeout = window.setTimeout(() => {
      if (!live || finished) return
      setSnapshot((current) => ({
        ...current,
        state: current.sections.some((section) => section.fields.length) ? 'partial' : 'error',
        message: current.sections.some((section) => section.fields.length)
          ? 'Some advanced sources timed out. Available metadata is shown.'
          : 'Advanced metadata unavailable.',
      }))
    }, 12000)

    setSnapshot((current) => ({ ...current, state: 'loading' }))
    void Promise.allSettled([
      animeDetailsService.getOverview(malId),
      franchiseService.getFranchise(malId),
      animeProvider.getAnime(malId),
    ]).then(async ([overviewResult, franchiseResult, animeResult]) => {
      if (!live) return
      if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value)
      if (franchiseResult.status === 'fulfilled') setFranchise(franchiseResult.value)
      if (animeResult.status !== 'fulfilled') throw animeResult.reason
      return loadNerdDataProgressive(malId, animeResult.value, (next) => { if (live) setSnapshot(next) })
    }).then((final) => {
      finished = true
      if (live && final) setSnapshot(final)
    }).catch((error) => {
      finished = true
      if (live) setSnapshot({ state: 'error', sections: [], completedSources: 0, totalSources: 4, failedSources: 4, message: error instanceof Error ? error.message : 'Advanced metadata unavailable.' })
    }).finally(() => window.clearTimeout(outerTimeout))

    return () => {
      live = false
      window.clearTimeout(outerTimeout)
    }
  }, [malId])

  const franchiseAnalytics = useMemo(() => analyticsService.calculateFranchiseAnalytics(franchise), [franchise])
  const directorField = findField(snapshot, ['Director'])
  const creatorField = findField(snapshot, ['Original creator'])
  const castField = findField(snapshot, ['Japanese voice cast'])
  const staffField = findField(snapshot, ['Key animation staff', 'Staff producers'])
  const sourceField = findField(snapshot, ['Manga / Light Novel title', 'Source format'])
  const streamingField = findField(snapshot, ['Recorded streaming providers'])
  const licensorsField = findField(snapshot, ['Licensors'])
  const anime = overview?.anime

  const production: Indicator[] = [
    available('1. Director', overview?.director ?? textValue(directorField), directorField?.datum.sourceUrl ?? anime?.url),
    available('2. Original Creator / Mangaka', overview?.creator ?? textValue(creatorField), creatorField?.datum.sourceUrl ?? anime?.url, !overview?.creator && Boolean(textValue(creatorField))),
    available('3. Main Voice Cast', textValue(castField), castField?.datum.sourceUrl),
    available('4. Animation Studio', overview?.studio ?? anime?.studios?.map((entry) => entry.name).join(' · '), anime?.url),
    available('5. Production Staff', textValue(staffField), staffField?.datum.sourceUrl, true),
    available('6. Original Source', overview?.sourceTitle ?? textValue(sourceField) ?? overview?.sourceType ?? anime?.source, sourceField?.datum.sourceUrl ?? anime?.url),
    unavailable('7. Publisher / Magazine'),
  ]

  const manga: Indicator[] = [
    unavailable('8. Manga Volumes / Chapters'),
    unavailable('9. Manga Sales'),
    unavailable('10. Total Circulation'),
    unavailable('11. Sales Evolution'),
    unavailable('12. Anime Effect on Source Sales', 'Historical sales data required'),
  ]

  const malStats = anime
    ? [`Score ${anime.score?.toFixed(2) ?? '—'}`, `Rank ${anime.rank != null ? `#${anime.rank}` : '—'}`, `Popularity ${anime.popularity != null ? `#${anime.popularity}` : '—'}`, `Members ${anime.members?.toLocaleString() ?? '—'}`, `Favorites ${anime.favorites?.toLocaleString() ?? '—'}`].join(' · ')
    : null

  const market: Indicator[] = [
    available('13. MAL Statistics', malStats, anime?.url),
    available('15. International Distribution', textValue(licensorsField), licensorsField?.datum.sourceUrl, true),
    unavailable('16. Brazil Availability / Distribution'),
    available('17. Streaming Availability', textValue(streamingField), streamingField?.datum.sourceUrl, true),
    unavailable('18. Movie Box Office'),
    unavailable('19. Awards & Nominations'),
  ]

  const franchiseIndicators: Indicator[] = [
    available('14. Franchise Score Timeline', franchiseAnalytics.scoredWorks >= 2 ? `${franchiseAnalytics.scoredWorks} scored entries` : null),
    available('20. Franchise Analytics', franchise ? `${franchiseAnalytics.totalWorks} works · Avg ${franchiseAnalytics.average?.toFixed(2) ?? '—'} · Range ${franchiseAnalytics.scoreRange?.toFixed(2) ?? '—'}` : null),
  ]

  return (
    <div className="nerd-progressive-dashboard compact-nerd-dashboard" data-state={snapshot.state}>
      <div className="nerd-progressive-status">
        <div><span className={`nerd-state-dot ${snapshot.state}`} /><strong>{snapshot.state === 'loading' ? 'Loading available indicators…' : snapshot.state === 'success' ? 'Advanced Database ready' : snapshot.state === 'partial' ? 'Advanced Database partially available' : snapshot.state === 'empty' ? 'No advanced metadata available' : snapshot.state === 'error' ? 'Advanced metadata unavailable' : 'Advanced Database'}</strong></div>
        <small>{snapshot.completedSources}/{snapshot.totalSources} advanced sources completed{snapshot.failedSources ? ` · ${snapshot.failedSources} unavailable` : ''}</small>
      </div>
      {snapshot.message && <div className={snapshot.state === 'error' ? 'notice error' : 'notice'}>{snapshot.message}</div>}

      <div className="nerd-compact-groups">
        <IndicatorGroup title="Production" indicators={production} />
        <IndicatorGroup title="Manga" indicators={manga} />
        <IndicatorGroup title="Audience & Market" indicators={market} />
        <IndicatorGroup title="Franchise" indicators={franchiseIndicators} />
      </div>

      <div className="nerd-mini-timeline">
        <div><span className="eyebrow">FRANCHISE SCORE TIMELINE</span><h3>Scores over time</h3></div>
        <ScoreTimeline works={franchise?.works ?? []} compact />
      </div>

      <button className="deep-analysis-button" type="button" onClick={() => navigate(`/app/anime/${malId}?view=analysis`)}>
        <span><b>Deep Analysis</b><small>Advanced charts, markets, franchise and global analytics</small></span>
        <strong>→</strong>
      </button>
    </div>
  )
}

export default function NerdDataProgressiveEnhancer() {
  const location = useLocation()
  const match = location.pathname.match(/^\/app\/anime\/(\d+)$/)
  const malId = match ? Number(match[1]) : null
  const isDeepAnalysis = new URLSearchParams(location.search).get('view') === 'analysis'
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [activated, setActivated] = useState(false)

  useEffect(() => {
    setHost(null)
    setActivated(false)
    if (!malId || isDeepAnalysis) return
    let mounted: HTMLDivElement | null = null

    const sync = () => {
      const section = document.querySelector('.details-v2-nerd-section') as HTMLElement | null
      if (!section) return
      const heading = section.querySelector('.details-v2-section-heading h2')
      const subtitle = section.querySelector('.details-v2-section-heading p')
      if (heading) heading.textContent = 'For Nerds'
      if (subtitle) subtitle.textContent = 'Advanced Database · compact technical indicators with explicit data availability.'
      section.querySelectorAll(':scope > .details-v2-nerd-loading, :scope > .details-v2-nerd-grid, :scope > .notice').forEach((node) => {
        if (node instanceof HTMLElement && !node.classList.contains('nerd-progressive-host')) node.style.display = 'none'
      })
      const existing = section.querySelector(':scope > .nerd-progressive-host') as HTMLDivElement | null
      if (existing) { mounted = existing; setHost(existing); return }
      const next = document.createElement('div')
      next.className = 'nerd-progressive-host'
      section.appendChild(next)
      mounted = next
      setHost(next)
    }

    sync()
    const observer = new MutationObserver(sync)
    const root = document.getElementById('root')
    if (root) observer.observe(root, { childList: true, subtree: true })
    return () => { observer.disconnect(); mounted?.remove() }
  }, [malId, isDeepAnalysis])

  useEffect(() => {
    if (!host || activated) return
    const section = host.closest('.details-v2-nerd-section')
    if (!section) return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      setActivated(true)
      observer.disconnect()
    }, { rootMargin: '650px 0px' })
    observer.observe(section)
    return () => observer.disconnect()
  }, [host, activated])

  if (!host || !malId) return null
  return createPortal(
    activated ? <NerdDashboard malId={malId} /> : <div className="nerd-progressive-idle"><span>Advanced Database will load as this section enters view.</span></div>,
    host,
  )
}
