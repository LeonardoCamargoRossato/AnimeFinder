import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { listWatched, removeWatched, saveWatched, watchedFromAnime } from './catalog'
import SynopsisAudioPlayer from './SynopsisAudioPlayer'
import { loadSynopsisBundle, type SynopsisBundle } from './synopsis'
import {
  animeDetailsService,
  franchiseService,
  type AnimeDetailsOverview,
  type FranchiseResult,
  type RelatedWork,
} from './animeDetails'
import './details-v2.css'

function detectOriginalSpeechLanguage(text: string) {
  if (/[ぁ-ゟ゠-ヿ]/u.test(text)) return 'ja-JP'
  if (/\p{Script=Han}/u.test(text)) return 'zh-CN'
  return 'en-US'
}

function labelForSpeechLanguage(lang: string) {
  if (lang === 'pt-BR') return 'Português (Brasil)'
  if (lang === 'ja-JP') return 'Japonês'
  if (lang === 'zh-CN') return 'Chinês'
  return 'Inglês'
}

function RelatedWorkCard({ work, selectedId, onOpen }: { work: RelatedWork; selectedId: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={work.malId === selectedId ? 'details-v2-related-card current' : 'details-v2-related-card'}
      onClick={onOpen}
      aria-label={`Open ${work.title}`}
    >
      <div className="details-v2-related-poster">
        {work.poster ? <img src={work.poster} alt="" loading="lazy" /> : <span>No image</span>}
        <span className="details-v2-relation-badge">{work.malId === selectedId ? 'Current' : work.relationType}</span>
      </div>
      <div className="details-v2-related-copy">
        <strong>{work.title}</strong>
        <span className="details-v2-related-score">★ {work.malScore?.toFixed(2) ?? '—'}</span>
        <small>{[work.type, work.year].filter(Boolean).join(' • ') || 'Anime'}</small>
      </div>
    </button>
  )
}

function DetailsSkeleton() {
  return (
    <div className="page details-v2-page">
      <div className="details-v2-hero details-v2-skeleton">
        <div className="skeleton details-v2-poster-skeleton" />
        <div className="details-v2-skeleton-copy">
          <div className="skeleton line small" />
          <div className="skeleton line wide" />
          <div className="skeleton line" />
          <div className="skeleton line wide" />
        </div>
      </div>
    </div>
  )
}

function AnimeDetailsV2({ malId }: { malId: number }) {
  const navigate = useNavigate()
  const [overview, setOverview] = useState<AnimeDetailsOverview | null>(null)
  const [overviewError, setOverviewError] = useState('')
  const [watched, setWatched] = useState(false)
  const [franchise, setFranchise] = useState<FranchiseResult | null>(null)
  const [franchiseLoading, setFranchiseLoading] = useState(true)
  const [franchiseError, setFranchiseError] = useState('')
  const [franchiseInfoOpen, setFranchiseInfoOpen] = useState(false)
  const [synopsis, setSynopsis] = useState<SynopsisBundle | null>(null)
  const [synopsisLoading, setSynopsisLoading] = useState(true)
  const [showOriginal, setShowOriginal] = useState(false)
  const [audioOpen, setAudioOpen] = useState(false)

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
    setOverview(null)
    setOverviewError('')
    setFranchise(null)
    setFranchiseLoading(true)
    setFranchiseError('')
    setSynopsis(null)
    setSynopsisLoading(true)
    setShowOriginal(false)
    setAudioOpen(false)

    let live = true
    void Promise.all([animeDetailsService.getOverview(malId), listWatched()])
      .then(([nextOverview, rows]) => {
        if (!live) return
        setOverview(nextOverview)
        setWatched(rows.some((row) => row.mal_id === malId))
      })
      .catch((reason) => live && setOverviewError(reason instanceof Error ? reason.message : 'Could not load this anime.'))

    void franchiseService.getFranchise(malId)
      .then((result) => live && setFranchise(result))
      .catch((reason) => live && setFranchiseError(reason instanceof Error ? reason.message : 'Could not load related works.'))
      .finally(() => live && setFranchiseLoading(false))

    void loadSynopsisBundle(malId)
      .then((bundle) => live && setSynopsis(bundle))
      .catch(() => live && setSynopsis({ original: null, portuguese: null, source: null }))
      .finally(() => live && setSynopsisLoading(false))

    return () => { live = false }
  }, [malId])

  const visibleSynopsis = showOriginal ? synopsis?.original : synopsis?.portuguese || synopsis?.original
  const synopsisIsPortuguese = !showOriginal && Boolean(synopsis?.portuguese)
  const speechLang = visibleSynopsis ? (synopsisIsPortuguese ? 'pt-BR' : detectOriginalSpeechLanguage(visibleSynopsis)) : 'pt-BR'

  async function toggleWatched() {
    if (!overview) return
    try {
      if (watched) await removeWatched(overview.anime.malId)
      else await saveWatched(watchedFromAnime(overview.anime))
      setWatched((value) => !value)
    } catch (reason) {
      setOverviewError(reason instanceof Error ? reason.message : 'Could not update your catalog.')
    }
  }

  if (overviewError && !overview) return <div className="page narrow-page"><div className="notice error">{overviewError}</div></div>
  if (!overview) return <DetailsSkeleton />

  const anime = overview.anime
  const franchiseAverage = franchise?.average
  const hasBothSynopsisLanguages = Boolean(synopsis?.original && synopsis?.portuguese)

  return (
    <div className="page details-v2-page">
      <button className="text-button back-button details-v2-back" onClick={() => navigate(-1)}>← Back</button>

      <section className="details-v2-hero">
        <div className="details-v2-poster-wrap">
          {anime.largeImageUrl || anime.imageUrl
            ? <img src={anime.largeImageUrl || anime.imageUrl!} alt={anime.title} />
            : <div className="details-v2-poster-missing">No poster</div>}
          <span>MAL #{anime.malId}</span>
        </div>

        <div className="details-v2-copy">
          <div className="eyebrow">ANIME OVERVIEW</div>
          <h1>{anime.title}</h1>
          {anime.titleEnglish && anime.titleEnglish !== anime.title && <h2>{anime.titleEnglish}</h2>}
          {anime.titleJapanese && <div className="details-v2-original-title">{anime.titleJapanese}</div>}

          <div className="details-v2-score-row">
            <div className="details-v2-score franchise-score">
              <div className="details-v2-score-label">
                <span>Franchise Average</span>
                <div className="details-v2-info-wrap" onMouseLeave={() => setFranchiseInfoOpen(false)}>
                  <button type="button" onClick={() => setFranchiseInfoOpen((value) => !value)} aria-label="Explain Franchise Average">ⓘ</button>
                  <div className={franchiseInfoOpen ? 'details-v2-info-popover open' : 'details-v2-info-popover'}>
                    AnimeFinder Franchise Average is calculated from the available MyAnimeList scores of the related anime works shown below. It is an AnimeFinder metric and is not an official MyAnimeList score.
                  </div>
                </div>
              </div>
              <strong>★ {franchiseLoading ? '…' : franchiseAverage?.toFixed(2) ?? '—'}</strong>
              <small>{franchise?.scoredWorkCount ? `${franchise.scoredWorkCount} scored works` : 'AnimeFinder metric'}</small>
            </div>
            <div className="details-v2-score">
              <span>MAL Score</span>
              <strong>★ {anime.score?.toFixed(2) ?? '—'}</strong>
              <small>Selected anime</small>
            </div>
          </div>

          <div className="details-v2-meta-grid">
            <div><span>Director</span><strong>{overview.director ?? 'No data'}</strong></div>
            <div><span>Original Creator</span><strong>{overview.creator ?? 'No data'}</strong></div>
            <div><span>Source</span><strong>{overview.sourceTitle ?? overview.sourceType ?? anime.source ?? 'No data'}</strong><small>{overview.sourceTitle && overview.sourceType ? overview.sourceType : ''}</small></div>
            <div><span>Studio</span><strong>{overview.studio ?? 'No data'}</strong></div>
          </div>

          <div className="details-v2-facts">
            <span><b>{anime.type ?? '—'}</b> Type</span>
            <span><b>{anime.status ?? '—'}</b> Status</span>
            <span><b>{anime.year ?? '—'}</b> Year</span>
            <span><b>{anime.episodes ?? '—'}</b> Episodes</span>
          </div>

          <div className="genre-row large">{anime.genres.map((genre) => <span key={genre.id}>{genre.name}</span>)}</div>

          <div className="details-actions details-v2-actions">
            <button className={watched ? 'primary-button watched-primary' : 'primary-button'} onClick={toggleWatched}>{watched ? '✓ Watched' : '+ Mark as watched'}</button>
            {anime.url && <a className="ghost-button link-button" href={anime.url} target="_blank" rel="noreferrer">Open on MyAnimeList ↗</a>}
          </div>
        </div>
      </section>

      <section className="details-v2-synopsis-section">
        <div className="details-v2-section-heading">
          <div><span className="eyebrow">STORY</span><h2>Synopsis</h2></div>
          <div className="details-v2-synopsis-actions">
            {hasBothSynopsisLanguages && <button className="ghost-button" onClick={() => setShowOriginal((value) => !value)}>{showOriginal ? 'Ver em português' : 'Ver original'}</button>}
            {!synopsisLoading && visibleSynopsis && <button className="ghost-button" onClick={() => setAudioOpen(true)}>🔊 Escutar</button>}
          </div>
        </div>
        {synopsisLoading ? (
          <div className="details-v2-text-skeleton"><span /><span /><span /></div>
        ) : visibleSynopsis ? (
          <p>{visibleSynopsis}</p>
        ) : (
          <div className="details-v2-missing">No synopsis available from the selected anime sources.</div>
        )}
        {audioOpen && visibleSynopsis && (
          <SynopsisAudioPlayer
            key={`${malId}-${showOriginal ? 'original' : 'portuguese'}-${speechLang}`}
            text={visibleSynopsis}
            lang={speechLang}
            languageLabel={labelForSpeechLanguage(speechLang)}
            onClose={() => setAudioOpen(false)}
          />
        )}
        {!synopsisLoading && synopsis?.source && <small className="details-v2-source-note">Source: {synopsis.source}{synopsisIsPortuguese ? ' · automatic pt-BR translation' : ''}</small>}
      </section>

      <section className="details-v2-related-section">
        <div className="details-v2-section-heading">
          <div><span className="eyebrow">FRANCHISE MAP</span><h2>Related Works</h2></div>
          {franchise && <span className="result-count">{franchise.works.length} works</span>}
        </div>
        {franchiseError && <div className="notice error">{franchiseError}</div>}
        {franchiseLoading ? (
          <div className="details-v2-related-track">{Array.from({ length: 6 }).map((_, index) => <div className="details-v2-related-card skeleton-card" key={index}><div className="skeleton details-v2-related-skeleton" /></div>)}</div>
        ) : franchise?.works.length ? (
          <div className="details-v2-related-track">
            {franchise.works.map((work) => <RelatedWorkCard key={work.malId} work={work} selectedId={malId} onOpen={() => navigate(`/app/anime/${work.malId}`)} />)}
          </div>
        ) : <div className="details-v2-missing">No structured franchise relations were found.</div>}
      </section>

      <section className="details-v2-title-section">
        <div className="details-v2-section-heading"><div><span className="eyebrow">IDENTIFICATION</span><h2>Known title variants</h2></div></div>
        <div className="details-v2-variant-grid">{anime.titles.map((title, index) => <div key={`${title.type}-${index}`}><span>{title.type}</span><strong>{title.title}</strong></div>)}</div>
      </section>

      <section className="details-v2-nerd-section">
        <div className="details-v2-section-heading">
          <div><span className="eyebrow">ADVANCED DATABASE</span><h2>For Nerds</h2><p>Quick technical info. Heavy metadata loads only after opening Deep Analysis.</p></div>
        </div>
      </section>
    </div>
  )
}

export default function AnimeDetailsV2Enhancer() {
  const location = useLocation()
  const match = location.pathname.match(/^\/app\/anime\/(\d+)$/)
  const malId = match ? Number(match[1]) : null
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setHost(null)
    if (!malId) return
    const hiddenPages = new Set<HTMLElement>()
    let mountedHost: HTMLDivElement | null = null

    const sync = () => {
      const main = document.querySelector('.app-shell > main') as HTMLElement | null
      if (!main) return
      Array.from(main.children).forEach((child) => {
        if (child instanceof HTMLElement && child.classList.contains('page')) {
          child.style.display = 'none'
          hiddenPages.add(child)
        }
      })
      const existing = main.querySelector(':scope > .anime-details-v2-host') as HTMLDivElement | null
      if (existing) {
        mountedHost = existing
        setHost(existing)
        return
      }
      const nextHost = document.createElement('div')
      nextHost.className = 'anime-details-v2-host'
      main.insertBefore(nextHost, main.firstChild)
      mountedHost = nextHost
      setHost(nextHost)
    }

    sync()
    const observer = new MutationObserver(sync)
    const root = document.getElementById('root')
    if (root) observer.observe(root, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      hiddenPages.forEach((page) => page.style.removeProperty('display'))
      mountedHost?.remove()
    }
  }, [malId])

  return host && malId ? createPortal(<AnimeDetailsV2 malId={malId} />, host) : null
}
