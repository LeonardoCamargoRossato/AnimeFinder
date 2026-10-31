import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { loadSynopsisBundle, type SynopsisBundle } from './synopsis'

export default function SynopsisEnhancer() {
  const location = useLocation()
  const match = location.pathname.match(/^\/app\/anime\/(\d+)$/)
  const malId = match ? Number(match[1]) : null
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [bundle, setBundle] = useState<SynopsisBundle | null>(null)
  const [loading, setLoading] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)

  useEffect(() => {
    setHost(null)
    if (!malId) return

    let mountedHost: HTMLDivElement | null = null
    let originalSynopsis: HTMLElement | null = null

    const syncHost = () => {
      const detailsCopy = document.querySelector('.details-copy')
      const actions = detailsCopy?.querySelector('.details-actions')
      const synopsis = detailsCopy?.querySelector('.synopsis') as HTMLElement | null
      if (!detailsCopy || !actions || !synopsis) return

      originalSynopsis = synopsis
      synopsis.style.display = 'none'

      const existing = detailsCopy.querySelector('.synopsis-enhancer-host') as HTMLDivElement | null
      if (existing) {
        mountedHost = existing
        setHost(existing)
        return
      }

      const nextHost = document.createElement('div')
      nextHost.className = 'synopsis-enhancer-host'
      detailsCopy.insertBefore(nextHost, actions)
      mountedHost = nextHost
      setHost(nextHost)
    }

    syncHost()
    const observer = new MutationObserver(syncHost)
    const root = document.getElementById('root')
    if (root) observer.observe(root, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      if (originalSynopsis) originalSynopsis.style.removeProperty('display')
      mountedHost?.remove()
    }
  }, [malId])

  useEffect(() => {
    setBundle(null)
    setShowOriginal(false)
    if (!malId) return

    let active = true
    setLoading(true)

    void loadSynopsisBundle(malId)
      .then((nextBundle) => {
        if (active) setBundle(nextBundle)
      })
      .catch(() => {
        if (active) setBundle({ original: null, portuguese: null, source: null })
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [malId])

  if (!malId || !host) return null

  const hasPortuguese = Boolean(bundle?.portuguese)
  const hasOriginal = Boolean(bundle?.original)
  const visibleText = showOriginal
    ? bundle?.original
    : bundle?.portuguese || bundle?.original

  return createPortal(
    <section className="synopsis-panel" aria-live="polite">
      <div className="synopsis-panel-header">
        <div>
          <span className="eyebrow">SINOPSE</span>
          <h3>{showOriginal ? 'Original' : 'Português'}</h3>
        </div>
        {hasOriginal && hasPortuguese && (
          <button className="synopsis-language-button" onClick={() => setShowOriginal((value) => !value)}>
            {showOriginal ? 'Ver em português' : 'Ver original'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="synopsis-loading">
          <span className="synopsis-loading-bar" />
          <span className="synopsis-loading-bar short" />
          <span>Preparando sinopse em português…</span>
        </div>
      ) : visibleText ? (
        <p className="synopsis synopsis-enhanced">{visibleText}</p>
      ) : (
        <p className="synopsis synopsis-enhanced">Sinopse indisponível nas fontes consultadas.</p>
      )}

      {!loading && bundle?.source && (
        <div className="synopsis-meta">
          <span>Fonte: {bundle.source}</span>
          {hasPortuguese && !showOriginal && <span>Tradução automática para pt-BR</span>}
          {!hasPortuguese && bundle.translationError && <span>Tradução automática indisponível no momento</span>}
        </div>
      )}
    </section>,
    host,
  )
}
