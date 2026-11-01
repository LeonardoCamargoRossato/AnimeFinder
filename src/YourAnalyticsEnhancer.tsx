import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { franchiseService, type FranchiseResult } from './animeDetails'
import { getPersonalAnalytics, type PersonalAnalytics } from './analytics'

function AnalyticsCard({ label, value, detail, className = '' }: { label: string; value: string; detail?: string; className?: string }) {
  return (
    <article className={`your-analytics-card ${className}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </article>
  )
}

function YourAnalytics({ malId }: { malId: number }) {
  const [data, setData] = useState<PersonalAnalytics | null>(null)
  const [franchise, setFranchise] = useState<FranchiseResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    void franchiseService.getFranchise(malId)
      .then(async (nextFranchise) => {
        if (!live) return
        setFranchise(nextFranchise)
        const analytics = await getPersonalAnalytics(malId, nextFranchise)
        if (live) setData(analytics)
      })
      .catch(async () => {
        try {
          const analytics = await getPersonalAnalytics(malId, null)
          if (live) setData(analytics)
        } catch (reason) {
          if (live) setError(reason instanceof Error ? reason.message : 'Personal analytics unavailable.')
        }
      })
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [malId])

  if (loading) return <div className="your-analytics-loading"><span className="spinner" /> Loading your personal analytics…</div>
  if (error) return <div className="notice error">{error}</div>
  if (!data) return <div className="analytics-no-data">No personal analytics available.</div>

  const completion = data.franchiseCompletion
  return (
    <div className="your-analytics-content">
      <div className="your-analytics-grid">
        <AnalyticsCard label="Watched status" value={data.watched ? '✓ Watched' : 'Not watched'} className={data.watched ? 'watched' : ''} />
        <AnalyticsCard
          label="My Ranking"
          value={data.rank != null ? `#${data.rank} of ${data.watchedCatalogSize}` : '—'}
          detail={data.rank == null ? 'No personal rank' : 'Personal Catalog'}
        />
        <AnalyticsCard
          label="Top"
          value={data.percentile != null ? `${data.percentile.toFixed(1)}%` : '—'}
          detail={data.percentile != null ? 'Position within watched catalog' : 'Ranking required'}
        />
        <AnalyticsCard
          label="Franchise completion"
          value={completion ? `${completion.watched}/${completion.total}` : '—'}
          detail={completion ? `${completion.percentage.toFixed(1)}% of mapped related works watched` : 'No franchise graph'}
        />
      </div>

      <div className="your-analytics-notes-grid">
        <article>
          <span>Original Observation</span>
          <p>{data.originalObservations || '—'}</p>
        </article>
        <article>
          <span>Comments</span>
          <p>{data.comments || '—'}</p>
        </article>
      </div>

      {data.similarWatched.length > 0 && (
        <div className="your-analytics-similar">
          <span>Related works already watched</span>
          <div>{data.similarWatched.slice(0, 8).map((work) => <b key={work.malId}>{work.title}</b>)}</div>
        </div>
      )}

      {franchise && !completion && <small className="analytics-muted">Franchise relationships are available, but no completion metric could be calculated.</small>}
    </div>
  )
}

export default function YourAnalyticsEnhancer() {
  const location = useLocation()
  const match = location.pathname.match(/^\/app\/anime\/(\d+)$/)
  const malId = match ? Number(match[1]) : null
  const isDeepAnalysis = new URLSearchParams(location.search).get('view') === 'analysis'
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setHost(null)
    if (!malId || isDeepAnalysis) return
    let mounted: HTMLDivElement | null = null

    const sync = () => {
      const page = document.querySelector('.details-v2-page') as HTMLElement | null
      const nerd = page?.querySelector('.details-v2-nerd-section') as HTMLElement | null
      if (!page || !nerd) return
      const existing = page.querySelector(':scope > .your-analytics-host') as HTMLDivElement | null
      if (existing) {
        mounted = existing
        setHost(existing)
        return
      }
      const next = document.createElement('div')
      next.className = 'your-analytics-host'
      page.insertBefore(next, nerd)
      mounted = next
      setHost(next)
    }

    sync()
    const observer = new MutationObserver(sync)
    const root = document.getElementById('root')
    if (root) observer.observe(root, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      mounted?.remove()
    }
  }, [malId, isDeepAnalysis])

  if (!host || !malId) return null
  return createPortal(
    <section className="your-analytics-section">
      <div className="details-v2-section-heading">
        <div><span className="eyebrow">PERSONAL DATA</span><h2>Your Analytics</h2><p>Your private AnimeFinder catalog metrics, kept separate from public MAL statistics.</p></div>
      </div>
      <YourAnalytics malId={malId} />
    </section>,
    host,
  )
}
