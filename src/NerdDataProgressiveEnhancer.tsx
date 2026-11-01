import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { animeProvider } from './providers'
import type { Anime } from './types'
import './nerd-progressive.css'

function SimpleFact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="nerd-simple-fact">
      <span>{label}</span>
      <strong>{value || 'No reliable data'}</strong>
    </div>
  )
}

function LightweightNerdDashboard({ malId }: { malId: number }) {
  const navigate = useNavigate()
  const [anime, setAnime] = useState<Anime | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let live = true
    setState('loading')
    setAnime(null)

    void animeProvider.getAnime(malId)
      .then((result) => {
        if (!live) return
        setAnime(result)
        setState('ready')
      })
      .catch(() => {
        if (!live) return
        setState('error')
      })

    return () => { live = false }
  }, [malId])

  const studios = anime?.studios?.map((studio) => studio.name).join(' · ') || null
  const source = anime?.source || null

  return (
    <div className="nerd-progressive-dashboard lightweight-nerd-dashboard" data-state={state}>
      {state === 'loading' ? (
        <div className="nerd-progressive-status">
          <div><span className="nerd-state-dot loading" /><strong>Loading basic technical info…</strong></div>
        </div>
      ) : state === 'error' ? (
        <div className="notice">Basic technical information unavailable.</div>
      ) : (
        <div className="nerd-simple-grid">
          <SimpleFact label="Studio" value={studios} />
          <SimpleFact label="Manga / Original Source" value={source} />
        </div>
      )}

      <button className="deep-analysis-button" type="button" onClick={() => navigate(`/app/anime/${malId}?view=analysis`)}>
        <span>
          <b>Deep Analysis</b>
          <small>Staff, voice cast, franchise charts, market data and advanced analytics</small>
        </span>
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

  useEffect(() => {
    setHost(null)
    if (!malId || isDeepAnalysis) return
    let mounted: HTMLDivElement | null = null

    const sync = () => {
      const section = document.querySelector('.details-v2-nerd-section') as HTMLElement | null
      if (!section) return

      const heading = section.querySelector('.details-v2-section-heading h2')
      const subtitle = section.querySelector('.details-v2-section-heading p')
      if (heading) heading.textContent = 'For Nerds'
      if (subtitle) subtitle.textContent = 'Quick technical info. Advanced data is available only in Deep Analysis.'

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
  }, [malId, isDeepAnalysis])

  if (!host || !malId) return null
  return createPortal(<LightweightNerdDashboard malId={malId} />, host)
}
