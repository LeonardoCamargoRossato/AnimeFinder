import type { RelatedWork } from './animeDetails'

export function ScoreTimeline({ works, compact = false }: { works: RelatedWork[]; compact?: boolean }) {
  const scored = works.filter((work) => typeof work.malScore === 'number' && Number.isFinite(work.malScore))
  if (scored.length < 2) return <div className="analytics-no-data">Not enough scored franchise entries.</div>

  const sorted = [...scored].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title))
  const width = Math.max(compact ? 520 : 760, sorted.length * (compact ? 72 : 92))
  const height = compact ? 190 : 280
  const padding = compact ? 30 : 44
  const minScore = Math.max(0, Math.min(...sorted.map((work) => work.malScore as number)) - 0.5)
  const maxScore = Math.min(10, Math.max(...sorted.map((work) => work.malScore as number)) + 0.5)
  const span = Math.max(0.5, maxScore - minScore)
  const point = (work: RelatedWork, index: number) => ({
    x: padding + index * ((width - padding * 2) / Math.max(1, sorted.length - 1)),
    y: padding + (maxScore - (work.malScore as number)) * ((height - padding * 2) / span),
  })
  const points = sorted.map(point)

  return (
    <div className={compact ? 'analytics-timeline-wrap compact' : 'analytics-timeline-wrap'}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Franchise score timeline">
        {[0, 1, 2, 3].map((index) => {
          const y = padding + index * ((height - padding * 2) / 3)
          const score = maxScore - index * (span / 3)
          return <g key={index}><line x1={padding} x2={width - padding} y1={y} y2={y} className="analytics-grid-line" /><text x={8} y={y + 4} className="analytics-axis-label">{score.toFixed(1)}</text></g>
        })}
        <polyline points={points.map((entry) => `${entry.x},${entry.y}`).join(' ')} className="analytics-score-line" />
        {sorted.map((work, index) => {
          const p = points[index]
          return (
            <g key={work.malId} className="analytics-score-point">
              <circle cx={p.x} cy={p.y} r={compact ? 5 : 6} />
              <title>{work.title} · {work.malScore?.toFixed(2)} · {work.year ?? 'Year unknown'}</title>
              <text x={p.x} y={height - 12} textAnchor="middle" className="analytics-work-label">{shortTitle(work.title, compact ? 12 : 17)}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function shortTitle(title: string, max: number) {
  return title.length <= max ? title : `${title.slice(0, max - 1)}…`
}

export function FranchiseMap({ works, selectedId, onOpen }: { works: RelatedWork[]; selectedId: number; onOpen?: (malId: number) => void }) {
  if (!works.length) return <div className="analytics-no-data">No structured franchise graph available.</div>
  const sorted = [...works].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title))
  return (
    <div className="franchise-map" role="list" aria-label="Franchise relationship map">
      {sorted.map((work, index) => (
        <div className="franchise-map-step" key={work.malId}>
          {index > 0 && <span className="franchise-map-connector" aria-hidden="true">↓</span>}
          <button type="button" className={work.malId === selectedId ? 'franchise-map-node current' : 'franchise-map-node'} onClick={() => onOpen?.(work.malId)} disabled={!onOpen}>
            <span>{work.relationType}</span>
            <strong>{work.title}</strong>
            <small>{[work.type, work.year, work.malScore != null ? `★ ${work.malScore.toFixed(2)}` : null].filter(Boolean).join(' · ')}</small>
          </button>
        </div>
      ))}
    </div>
  )
}

export function GlobalFootprintPlaceholder() {
  const regions = ['North America', 'South America', 'Europe', 'Africa', 'Asia', 'Oceania']
  return (
    <div className="global-footprint-v0">
      <div className="global-layer-tabs" aria-label="Global Footprint layers">
        {['Distribution', 'Streaming', 'Publishing', 'Box Office', 'Search Interest'].map((layer, index) => <button key={layer} type="button" disabled={index > 1}>{layer}</button>)}
      </div>
      <div className="global-map-placeholder" aria-label="World map placeholder with no fabricated regional values">
        {regions.map((region) => <span key={region}>{region}<small>No reliable country-level dataset</small></span>)}
      </div>
      <p>No geographic value is inferred from popularity. Countries remain neutral until a structured regional source is connected.</p>
    </div>
  )
}
