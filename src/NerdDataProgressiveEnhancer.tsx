import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { animeProvider } from './providers'
import type { NerdSection } from './animeDetails'
import { loadNerdDataProgressive, type ProgressiveNerdSnapshot } from './nerdDataProgressive'
import './nerd-progressive.css'

function NerdValue({ value }: { value: string | string[] | number }) {
  if (Array.isArray(value)) return <ul>{value.map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}</ul>
  return <span>{String(value)}</span>
}

function ProgressiveSection({ section }: { section: NerdSection }) {
  const [open, setOpen] = useState(section.fields.length > 0 && ['publication', 'creators', 'animation'].includes(section.id))
  return (
    <article className={open ? 'details-v2-nerd-card open' : 'details-v2-nerd-card'}>
      <button type="button" className="details-v2-nerd-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>{section.label}</span>
        <small>{section.fields.length ? `${section.fields.length} fields` : 'No data'}</small>
        <b>{open ? '−' : '+'}</b>
      </button>
      {open && (
        <div className="details-v2-nerd-content">
          {section.fields.length ? section.fields.map((entry) => (
            <div className="details-v2-nerd-field" key={entry.label}>
              <span>{entry.label}</span>
              <div>
                <NerdValue value={entry.datum.value} />
                {entry.datum.sourceUrl
                  ? <a href={entry.datum.sourceUrl} target="_blank" rel="noreferrer">Source ↗</a>
                  : <small>Source: {entry.datum.source}</small>}
              </div>
            </div>
          )) : <div className="details-v2-no-data">No data from a reliable structured source yet.</div>}
        </div>
      )}
    </article>
  )
}

function NerdDashboard({ malId }: { malId: number }) {
  const [snapshot, setSnapshot] = useState<ProgressiveNerdSnapshot>({
    state: 'idle',
    sections: [],
    completedSources: 0,
    totalSources: 4,
    failedSources: 0,
  })

  useEffect(() => {
    let live = true
    let finished = false
    const outerTimeout = window.setTimeout(() => {
      if (!live || finished) return
      setSnapshot((current) => ({
        ...current,
        state: current.sections.some((section) => section.fields.length) ? 'partial' : 'error',
        message: current.sections.some((section) => section.fields.length)
          ? 'Some advanced sources timed out. Available metadata is shown below.'
          : 'Advanced metadata unavailable.',
      }))
    }, 12000)

    setSnapshot((current) => ({ ...current, state: 'loading' }))
    void animeProvider.getAnime(malId)
      .then((anime) => loadNerdDataProgressive(malId, anime, (next) => {
        if (live) setSnapshot(next)
      }))
      .then((final) => {
        finished = true
        if (live) setSnapshot(final)
      })
      .catch((error) => {
        finished = true
        if (live) setSnapshot({
          state: 'error',
          sections: [],
          completedSources: 0,
          totalSources: 4,
          failedSources: 4,
          message: error instanceof Error ? error.message : 'Advanced metadata unavailable.',
        })
      })
      .finally(() => window.clearTimeout(outerTimeout))

    return () => {
      live = false
      window.clearTimeout(outerTimeout)
    }
  }, [malId])

  const populated = snapshot.sections.reduce((sum, section) => sum + section.fields.length, 0)

  return (
    <div className="nerd-progressive-dashboard" data-state={snapshot.state}>
      <div className="nerd-progressive-status">
        <div>
          <span className={`nerd-state-dot ${snapshot.state}`} />
          <strong>{snapshot.state === 'loading' ? 'Loading advanced metadata…' : snapshot.state === 'success' ? 'Advanced metadata loaded' : snapshot.state === 'partial' ? 'Advanced metadata partially loaded' : snapshot.state === 'empty' ? 'No advanced metadata available' : snapshot.state === 'error' ? 'Advanced metadata unavailable' : 'Advanced metadata ready'}</strong>
        </div>
        <small>{snapshot.completedSources}/{snapshot.totalSources} sources completed{snapshot.failedSources ? ` · ${snapshot.failedSources} unavailable` : ''}</small>
      </div>

      {snapshot.message && <div className={snapshot.state === 'error' ? 'notice error' : 'notice'}>{snapshot.message}</div>}

      {snapshot.sections.length > 0 && (
        <div className="details-v2-nerd-grid">
          {snapshot.sections.map((section) => <ProgressiveSection key={section.id} section={section} />)}
        </div>
      )}

      {snapshot.state === 'loading' && populated === 0 && (
        <div className="nerd-progressive-skeleton">
          {Array.from({ length: 4 }).map((_, index) => <span key={index} />)}
        </div>
      )}
    </div>
  )
}

export default function NerdDataProgressiveEnhancer() {
  const location = useLocation()
  const match = location.pathname.match(/^\/app\/anime\/(\d+)$/)
  const malId = match ? Number(match[1]) : null
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [activated, setActivated] = useState(false)

  useEffect(() => {
    setHost(null)
    setActivated(false)
    if (!malId) return
    let mounted: HTMLDivElement | null = null

    const sync = () => {
      const section = document.querySelector('.details-v2-nerd-section') as HTMLElement | null
      if (!section) return
      section.querySelectorAll(':scope > .details-v2-nerd-loading, :scope > .details-v2-nerd-grid, :scope > .notice').forEach((node) => {
        if (node instanceof HTMLElement && !node.classList.contains('nerd-progressive-host')) node.style.display = 'none'
      })
      const existing = section.querySelector(':scope > .nerd-progressive-host') as HTMLDivElement | null
      if (existing) {
        mounted = existing
        setHost(existing)
        return
      }
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
    return () => {
      observer.disconnect()
      mounted?.remove()
    }
  }, [malId])

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
    activated
      ? <NerdDashboard malId={malId} />
      : <div className="nerd-progressive-idle"><span>Advanced metadata will load as this section enters view.</span></div>,
    host,
  )
}
