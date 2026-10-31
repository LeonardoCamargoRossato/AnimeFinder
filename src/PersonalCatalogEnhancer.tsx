import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Anime } from './types'
import {
  personalCatalogCategories,
  personalCatalogRepository,
  type PersonalCatalogCategory,
  type PersonalCatalogItem,
} from './personalCatalog'

const CATALOG_STATE_KEY = 'animefinder.personalCatalog.state'

type CatalogState = {
  category?: PersonalCatalogCategory
  query?: string
  scrollY?: number
}

function readSavedState(): CatalogState {
  try {
    return JSON.parse(sessionStorage.getItem(CATALOG_STATE_KEY) ?? '{}') as CatalogState
  } catch {
    return {}
  }
}

function saveState(state: CatalogState) {
  sessionStorage.setItem(CATALOG_STATE_KEY, JSON.stringify(state))
}

function CatalogPoster({ item, onOpen }: { item: PersonalCatalogItem; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [metadata, setMetadata] = useState<Anime | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!item.malId || !ref.current) return
    let live = true
    const target = ref.current
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void personalCatalogRepository.getMetadata(item.malId!)
        .then((anime) => live && setMetadata(anime))
        .catch(() => live && setFailed(true))
    }, { rootMargin: '320px 0px' })

    observer.observe(target)
    return () => {
      live = false
      observer.disconnect()
    }
  }, [item.malId])

  const image = metadata?.imageUrl ?? metadata?.largeImageUrl
  const clickable = Boolean(item.malId)

  return (
    <button
      ref={ref}
      type="button"
      className={clickable ? 'catalog-poster clickable' : 'catalog-poster'}
      onClick={clickable ? onOpen : undefined}
      disabled={!clickable}
      title={clickable ? `Open ${item.anime}` : 'No MyAnimeList ID available'}
      aria-label={clickable ? `Open ${item.anime} details` : `${item.anime} has no linked anime details`}
    >
      {image && !failed
        ? <img src={image} alt="" loading="lazy" onError={() => setFailed(true)} />
        : <span className="catalog-poster-placeholder">{item.anime.slice(0, 2).toUpperCase()}</span>}
    </button>
  )
}

function ObservationCell({ value }: { value: string | null }) {
  const [expanded, setExpanded] = useState(false)
  if (!value) return <span className="catalog-empty">—</span>
  return (
    <button
      type="button"
      className={expanded ? 'catalog-observation expanded' : 'catalog-observation'}
      onClick={() => setExpanded((current) => !current)}
      title={expanded ? 'Collapse observation' : 'Click to read the full observation'}
    >
      {value}
    </button>
  )
}

function CatalogRow({ item, showRank, onOpen }: { item: PersonalCatalogItem; showRank: boolean; onOpen: () => void }) {
  return (
    <tr>
      <td className="catalog-poster-cell"><CatalogPoster item={item} onOpen={onOpen} /></td>
      <td className="catalog-anime-cell">
        <strong>{item.anime}</strong>
        <span className="catalog-mobile-alt">{item.englishName || item.originalName || '—'}</span>
      </td>
      <td className="catalog-score-cell">
        {item.malScore == null ? <span className="catalog-empty">—</span> : <span className="catalog-score">★ {item.malScore.toFixed(2)}</span>}
      </td>
      <td className="catalog-observation-cell"><ObservationCell value={item.observations} /></td>
      <td className="catalog-secondary-column">{item.englishName ?? <span className="catalog-empty">—</span>}</td>
      <td className="catalog-secondary-column">{item.originalName ?? <span className="catalog-empty">—</span>}</td>
      <td className="catalog-mal-column">
        {item.malUrl
          ? <a href={item.malUrl} target="_blank" rel="noreferrer" className="catalog-mal-link">View on MAL ↗</a>
          : <span className="catalog-empty">—</span>}
      </td>
      {showRank && <td className="catalog-rank-cell">{item.myRanked == null ? <span className="catalog-empty">—</span> : <strong>#{item.myRanked}</strong>}</td>}
    </tr>
  )
}

function PersonalCatalogPage() {
  const navigate = useNavigate()
  const saved = useMemo(readSavedState, [])
  const [category, setCategory] = useState<PersonalCatalogCategory>(saved.category ?? 'watched')
  const [query, setQuery] = useState(saved.query ?? '')
  const rows = useMemo(() => personalCatalogRepository.search(category, query), [category, query])
  const showRank = category === 'watched'
  const restored = useRef(false)

  useEffect(() => {
    saveState({ category, query, scrollY: window.scrollY })
  }, [category, query])

  useEffect(() => {
    if (restored.current || saved.scrollY == null) return
    restored.current = true
    const restore = () => window.scrollTo({ top: saved.scrollY ?? 0, behavior: 'auto' })
    requestAnimationFrame(() => requestAnimationFrame(restore))
  }, [saved.scrollY, rows.length])

  function openDetails(item: PersonalCatalogItem) {
    if (!item.malId) return
    saveState({ category, query, scrollY: window.scrollY })
    navigate(`/app/anime/${item.malId}`, { state: { fromPersonalCatalog: true } })
  }

  return (
    <div className="page personal-catalog-page">
      <section className="page-intro personal-catalog-intro">
        <span className="eyebrow">PERSONAL CATALOG</span>
        <h1>Personal Catalog</h1>
        <p>Your curated anime collection, preserving personal rankings, notes and validated MyAnimeList references.</p>
      </section>

      <div className="personal-catalog-search-row">
        <div className="personal-catalog-search">
          <span>⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search anime, English/original title or observations…"
            aria-label="Search selected personal catalog"
          />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button>}
        </div>
        <span className="personal-catalog-count">{rows.length} {rows.length === 1 ? 'entry' : 'entries'}</span>
      </div>

      <nav className="personal-catalog-tabs" aria-label="Personal catalog categories">
        {personalCatalogCategories.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={category === tab.id ? 'active' : ''}
            onClick={() => {
              setCategory(tab.id)
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          >
            {tab.label}
            <span>{personalCatalogRepository.list(tab.id).length}</span>
          </button>
        ))}
      </nav>

      <section className="personal-catalog-table-shell">
        <div className="personal-catalog-table-header">
          <div>
            <span className="eyebrow">{personalCatalogCategories.find((tab) => tab.id === category)?.label.toUpperCase()}</span>
            <h2>{personalCatalogCategories.find((tab) => tab.id === category)?.label}</h2>
          </div>
          <span className="personal-catalog-source">Google Sheets snapshot · MAL IDs preserved</span>
        </div>

        {rows.length ? (
          <div className="personal-catalog-table-wrap">
            <table className="personal-catalog-table">
              <thead>
                <tr>
                  <th>Poster</th>
                  <th>Anime</th>
                  <th>MAL Score</th>
                  <th>Observations</th>
                  <th className="catalog-secondary-column">Full English Name</th>
                  <th className="catalog-secondary-column">Original Full Name</th>
                  <th className="catalog-mal-column">MyAnimeList</th>
                  {showRank && <th>My Ranked</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((item, index) => (
                  <CatalogRow
                    key={`${item.category}-${item.malId ?? item.anime}-${item.myRanked ?? index}`}
                    item={item}
                    showRank={showRank}
                    onOpen={() => openDetails(item)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="personal-catalog-empty">
            <strong>No matching entries</strong>
            <span>Try another search or switch catalog tabs.</span>
          </div>
        )}
      </section>
    </div>
  )
}

export default function PersonalCatalogEnhancer() {
  const location = useLocation()
  const active = location.pathname === '/app/my-anime'
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setHost(null)
    if (!active) return

    let mountedHost: HTMLDivElement | null = null
    let hiddenPage: HTMLElement | null = null

    const sync = () => {
      const main = document.querySelector('.app-shell > main') as HTMLElement | null
      if (!main) return

      hiddenPage = Array.from(main.children).find((child) => child.classList.contains('page') && !child.classList.contains('personal-catalog-host')) as HTMLElement | null
      if (hiddenPage) hiddenPage.style.display = 'none'

      const existing = main.querySelector(':scope > .personal-catalog-host') as HTMLDivElement | null
      if (existing) {
        mountedHost = existing
        setHost(existing)
        return
      }

      const nextHost = document.createElement('div')
      nextHost.className = 'personal-catalog-host'
      main.appendChild(nextHost)
      mountedHost = nextHost
      setHost(nextHost)
    }

    sync()
    const observer = new MutationObserver(sync)
    const root = document.getElementById('root')
    if (root) observer.observe(root, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      if (hiddenPage) hiddenPage.style.removeProperty('display')
      mountedHost?.remove()
    }
  }, [active])

  return host && active ? createPortal(<PersonalCatalogPage />, host) : null
}
