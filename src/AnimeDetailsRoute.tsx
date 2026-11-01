import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { animeProvider } from './providers'
import type { Anime } from './types'
import { isAnimeWatched, listWatched, removeWatched, saveWatched, watchedFromAnime } from './catalog'
import { isPersonalCatalogWatched } from './personalCatalog'
import { franchiseService, type FranchiseResult, type RelatedWork } from './animeDetails'
import { getPersonalAnalytics, type PersonalAnalytics } from './analytics'
import { loadSynopsisBundle, type SynopsisBundle } from './synopsis'
import SynopsisAudioPlayer from './SynopsisAudioPlayer'
import './details-v2.css'
import './details-progressive.css'

const DeepAnalysisPage = lazy(() => import('./DeepAnalysisPage'))

type DeferredState = 'idle' | 'loading' | 'success' | 'error'

function DeferredSection<T>({
  eyebrow,
  title,
  description,
  load,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  load: () => Promise<T>
  children: (data: T) => ReactNode
}) {
  const [state, setState] = useState<DeferredState>('idle')
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')

  async function handleLoad() {
    setState('loading')
    setError('')
    try {
      const value = await load()
      setData(value)
      setState('success')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load this section.')
      setState('error')
    }
  }

  return (
    <section className="details-v2-deferred-section">
      <div className="details-v2-section-heading deferred-heading">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {state !== 'success' && (
          <button className="ghost-button deferred-load-button" type="button" disabled={state === 'loading'} onClick={handleLoad}>
            {state === 'loading' ? 'Loading…' : state === 'error' ? 'Retry' : 'Load'}
          </button>
        )}
      </div>

      {state === 'loading' && (
        <div className="deferred-loading" role="status" aria-live="polite">
          <div className="deferred-loading-row"><span className="spinner" /><strong>Loading {title}…</strong></div>
          <div className="deferred-progress"><span /></div>
          <small>This section is loading independently. The rest of Anime Details remains usable.</small>
        </div>
      )}
      {state === 'error' && <div className="notice error">{error}</div>}
      {state === 'success' && data != null && <div className="deferred-content">{children(data)}</div>}
    </section>
  )
}

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

function RelatedWorkCard({ work, selectedId, watched, onOpen }: { work: RelatedWork; selectedId: number; watched: boolean; onOpen: () => void }) {
  return (
    <button type="button" className={work.malId === selectedId ? 'details-v2-related-card current' : 'details-v2-related-card'} onClick={onOpen} aria-label={`Open ${work.title}`}>
      <div className="details-v2-related-poster">
        {work.poster ? <img src={work.poster} alt="" loading="lazy" /> : <span>No image</span>}
        <span className="details-v2-relation-badge">{work.malId === selectedId ? 'Current' : work.relationType}</span>
        {watched && <span className="details-related-watched">✓</span>}
      </div>
      <div className="details-v2-related-copy">
        <strong>{work.title}</strong>
        <span className="details-v2-related-score">★ {work.malScore?.toFixed(2) ?? '—'}</span>
        <small>{[work.type, work.year].filter(Boolean).join(' • ') || 'Anime'}</small>
      </div>
    </button>
  )
}

function DetailsLoading() {
  return (
    <div className="page details-v2-page">
      <div className="details-basic-loading">
        <span className="spinner" />
        <div><strong>Loading anime…</strong><small>Only the core anime record is required before the page appears.</small></div>
      </div>
    </div>
  )
}

function PersonalAnalyticsView({ data }: { data: PersonalAnalytics }) {
  const completion = data.franchiseCompletion
  return (
    <div className="your-analytics-content">
      <div className="your-analytics-grid">
        <article className={data.watched ? 'your-analytics-card watched' : 'your-analytics-card'}><span>Watched status</span><strong>{data.watched ? '✓ Watched' : 'Not watched'}</strong></article>
        <article className="your-analytics-card"><span>My Ranking</span><strong>{data.rank != null ? `#${data.rank} of ${data.watchedCatalogSize}` : '—'}</strong><small>{data.rank != null ? 'Personal Catalog' : 'No personal rank'}</small></article>
        <article className="your-analytics-card"><span>Top</span><strong>{data.percentile != null ? `${data.percentile.toFixed(1)}%` : '—'}</strong><small>Position within watched catalog</small></article>
        <article className="your-analytics-card"><span>Franchise completion</span><strong>{completion ? `${completion.watched}/${completion.total}` : '—'}</strong><small>{completion ? `${completion.percentage.toFixed(1)}% mapped works watched` : 'Related Works still loading or unavailable'}</small></article>
      </div>
      <div className="your-analytics-notes-grid">
        <article><span>Original Observation</span><p>{data.originalObservations || '—'}</p></article>
        <article><span>Comments</span><p>{data.comments || '—'}</p></article>
      </div>
      {data.similarWatched.length > 0 && <div className="your-analytics-similar"><span>Related works already watched</span><div>{data.similarWatched.slice(0, 8).map((work) => <b key={work.malId}>{work.title}</b>)}</div></div>}
    </div>
  )
}

function AnimeDetailsPage({ malId }: { malId: number }) {
  const navigate = useNavigate()
  const [anime, setAnime] = useState<Anime | null>(null)
  const [animeError, setAnimeError] = useState('')
  const [watched, setWatched] = useState(() => isPersonalCatalogWatched(malId))
  const [watchedIds, setWatchedIds] = useState<Set<number>>(() => new Set(isPersonalCatalogWatched(malId) ? [malId] : []))
  const [watchedLoading, setWatchedLoading] = useState(true)
  const [synopsis, setSynopsis] = useState<SynopsisBundle | null>(null)
  const [synopsisLoading, setSynopsisLoading] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const [audioOpen, setAudioOpen] = useState(false)
  const [franchise, setFranchise] = useState<FranchiseResult | null>(null)
  const [franchiseLoading, setFranchiseLoading] = useState(false)
  const [franchiseError, setFranchiseError] = useState('')
  const [franchiseInfoOpen, setFranchiseInfoOpen] = useState(false)

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
    let live = true
    setAnime(null)
    setAnimeError('')
    setSynopsis(null)
    setFranchise(null)
    setFranchiseError('')
    setShowOriginal(false)
    setAudioOpen(false)
    setWatched(isPersonalCatalogWatched(malId))

    void animeProvider.getAnime(malId)
      .then((result) => { if (live) setAnime(result) })
      .catch((reason) => { if (live) setAnimeError(reason instanceof Error ? reason.message : 'Could not load this anime.') })

    setWatchedLoading(true)
    void listWatched()
      .then((rows) => {
        if (!live) return
        const ids = new Set(rows.map((row) => row.mal_id).filter((id): id is number => id != null))
        setWatchedIds(ids)
        setWatched(isAnimeWatched(malId, rows))
      })
      .catch(() => {
        if (live) setWatched(isPersonalCatalogWatched(malId))
      })
      .finally(() => { if (live) setWatchedLoading(false) })

    return () => { live = false }
  }, [malId])

  useEffect(() => {
    if (!anime) return
    let live = true

    setSynopsisLoading(true)
    void loadSynopsisBundle(malId)
      .then((bundle) => { if (live) setSynopsis(bundle) })
      .catch(() => { if (live) setSynopsis({ original: anime.synopsis ?? null, portuguese: null, source: 'MyAnimeList catalogue' }) })
      .finally(() => { if (live) setSynopsisLoading(false) })

    setFranchiseLoading(true)
    setFranchiseError('')
    const start = window.setTimeout(() => {
      void franchiseService.getFranchise(malId)
        .then((result) => { if (live) setFranchise(result) })
        .catch((reason) => { if (live) setFranchiseError(reason instanceof Error ? reason.message : 'Could not load related works.') })
        .finally(() => { if (live) setFranchiseLoading(false) })
    }, 50)

    return () => {
      live = false
      window.clearTimeout(start)
    }
  }, [anime, malId])

  const visibleSynopsis = showOriginal ? synopsis?.original : synopsis?.portuguese || synopsis?.original || anime?.synopsis
  const synopsisIsPortuguese = !showOriginal && Boolean(synopsis?.portuguese)
  const speechLang = visibleSynopsis ? (synopsisIsPortuguese ? 'pt-BR' : detectOriginalSpeechLanguage(visibleSynopsis)) : 'pt-BR'
  const hasBothSynopsisLanguages = Boolean(synopsis?.original && synopsis?.portuguese)
  const personalCatalogLocked = isPersonalCatalogWatched(malId)

  async function toggleWatched() {
    if (!anime || personalCatalogLocked) return
    try {
      if (watched) await removeWatched(anime.malId)
      else await saveWatched(watchedFromAnime(anime))
      const next = !watched
      setWatched(next)
      setWatchedIds((current) => {
        const ids = new Set(current)
        if (next) ids.add(anime.malId)
        else ids.delete(anime.malId)
        return ids
      })
    } catch (reason) {
      setAnimeError(reason instanceof Error ? reason.message : 'Could not update your watched state.')
    }
  }

  if (animeError && !anime) return <div className="page narrow-page"><div className="notice error">{animeError}</div><button className="ghost-button" onClick={() => navigate(-1)}>← Back</button></div>
  if (!anime) return <DetailsLoading />

  return (
    <div className="page details-v2-page">
      <button className="text-button back-button details-v2-back" onClick={() => navigate(-1)}>← Back</button>

      <section className="details-v2-hero">
        <div className="details-v2-poster-wrap">
          {anime.largeImageUrl || anime.imageUrl ? <img src={anime.largeImageUrl || anime.imageUrl!} alt={anime.title} /> : <div className="details-v2-poster-missing">No poster</div>}
          <span>MAL #{anime.malId}</span>
        </div>
        <div className="details-v2-copy">
          <div className="eyebrow">ANIME OVERVIEW</div>
          <h1>{anime.title}</h1>
          {anime.titleEnglish && anime.titleEnglish !== anime.title && <h2>{anime.titleEnglish}</h2>}
          {anime.titleJapanese && <div className="details-v2-original-title">{anime.titleJapanese}</div>}

          <div className="details-v2-score-row">
            <div className="details-v2-score franchise-score">
              <div className="details-v2-score-label"><span>Franchise Average</span><div className="details-v2-info-wrap" onMouseLeave={() => setFranchiseInfoOpen(false)}><button type="button" onClick={() => setFranchiseInfoOpen((value) => !value)} aria-label="Explain Franchise Average">ⓘ</button><div className={franchiseInfoOpen ? 'details-v2-info-popover open' : 'details-v2-info-popover'}>AnimeFinder Franchise Average is calculated from the available MyAnimeList scores of the related anime works shown below. It is an AnimeFinder metric and is not an official MyAnimeList score.</div></div></div>
              <strong>★ {franchiseLoading ? '…' : franchise?.average?.toFixed(2) ?? '—'}</strong>
              <small>{franchise?.scoredWorkCount ? `${franchise.scoredWorkCount} scored works` : franchiseLoading ? 'Loading independently…' : 'AnimeFinder metric'}</small>
            </div>
            <div className="details-v2-score"><span>MAL Score</span><strong>★ {anime.score?.toFixed(2) ?? '—'}</strong><small>Selected anime</small></div>
          </div>

          <div className="details-v2-meta-grid basic-meta-grid">
            <div><span>Studio</span><strong>{anime.studios?.map((studio) => studio.name).join(' · ') || 'No data'}</strong></div>
            <div><span>Source</span><strong>{anime.source ?? 'No data'}</strong></div>
          </div>
          <div className="details-v2-facts"><span><b>{anime.type ?? '—'}</b> Type</span><span><b>{anime.status ?? '—'}</b> Status</span><span><b>{anime.year ?? '—'}</b> Year</span><span><b>{anime.episodes ?? '—'}</b> Episodes</span></div>
          <div className="genre-row large">{anime.genres.map((genre) => <span key={genre.id}>{genre.name}</span>)}</div>

          <div className="details-actions details-v2-actions">
            <button className={watched ? 'primary-button watched-primary' : 'primary-button'} disabled={watchedLoading || personalCatalogLocked} onClick={toggleWatched}>{watchedLoading && !watched ? 'Checking watched…' : watched ? '✓ Watched' : '+ Mark as watched'}</button>
            {anime.url && <a className="ghost-button link-button" href={anime.url} target="_blank" rel="noreferrer">Open on MyAnimeList ↗</a>}
          </div>
        </div>
      </section>

      <section className="details-v2-synopsis-section">
        <div className="details-v2-section-heading"><div><span className="eyebrow">STORY</span><h2>Synopsis</h2></div><div className="details-v2-synopsis-actions">{hasBothSynopsisLanguages && <button className="ghost-button" onClick={() => setShowOriginal((value) => !value)}>{showOriginal ? 'Ver em português' : 'Ver original'}</button>}{!synopsisLoading && visibleSynopsis && <button className="ghost-button" onClick={() => setAudioOpen(true)}>🔊 Escutar</button>}</div></div>
        {synopsisLoading ? <div className="details-v2-text-skeleton"><span /><span /><span /></div> : visibleSynopsis ? <p>{visibleSynopsis}</p> : <div className="details-v2-missing">No synopsis available from the selected anime sources.</div>}
        {audioOpen && visibleSynopsis && <SynopsisAudioPlayer key={`${malId}-${showOriginal ? 'original' : 'portuguese'}-${speechLang}`} text={visibleSynopsis} lang={speechLang} languageLabel={labelForSpeechLanguage(speechLang)} onClose={() => setAudioOpen(false)} />}
        {!synopsisLoading && synopsis?.source && <small className="details-v2-source-note">Source: {synopsis.source}{synopsisIsPortuguese ? ' · automatic pt-BR translation' : ''}</small>}
      </section>

      <section className="details-v2-related-section">
        <div className="details-v2-section-heading"><div><span className="eyebrow">FRANCHISE MAP</span><h2>Related Works</h2><p>Loads separately so it can never block the overview above.</p></div>{franchise && <span className="result-count">{franchise.works.length} works</span>}</div>
        {franchiseError && <div className="notice error">{franchiseError}</div>}
        {franchiseLoading ? <div className="related-independent-loading"><div className="deferred-loading-row"><span className="spinner" /><strong>Loading Related Works…</strong></div><div className="deferred-progress"><span /></div></div> : franchise?.works.length ? <div className="details-v2-related-track">{franchise.works.map((work) => <RelatedWorkCard key={work.malId} work={work} selectedId={malId} watched={watchedIds.has(work.malId)} onOpen={() => navigate(`/app/anime/${work.malId}`)} />)}</div> : <div className="details-v2-missing">No structured franchise relations were found.</div>}
      </section>

      <DeferredSection eyebrow="IDENTIFICATION" title="Known title variants" description="Loaded only when requested, even though this information is already available locally." load={async () => anime.titles}>
        {(titles) => <div className="details-v2-variant-grid">{titles.map((title, index) => <div key={`${title.type}-${index}`}><span>{title.type}</span><strong>{title.title}</strong></div>)}</div>}
      </DeferredSection>

      <DeferredSection eyebrow="PERSONAL DATA" title="Your Analytics" description="Your private ranking, comments and watched metrics load only after you ask for them." load={() => getPersonalAnalytics(malId, franchise)}>
        {(data) => <PersonalAnalyticsView data={data} />}
      </DeferredSection>

      <DeferredSection eyebrow="ADVANCED DATABASE" title="For Nerds" description="The normal details page keeps this deliberately light. Heavy metadata stays in Deep Analysis." load={async () => ({ studio: anime.studios?.map((studio) => studio.name).join(' · ') || null, source: anime.source ?? null })}>
        {(data) => <div className="nerd-simple-grid"><div className="nerd-simple-fact"><span>Studio</span><strong>{data.studio || 'No reliable data'}</strong></div><div className="nerd-simple-fact"><span>Manga / Original Source</span><strong>{data.source || 'No reliable data'}</strong></div></div>}
      </DeferredSection>

      <section className="details-v2-deferred-section deep-analysis-entry">
        <div className="details-v2-section-heading"><div><span className="eyebrow">ADVANCED ANALYTICS</span><h2>Deep Analysis</h2><p>Advanced staff, markets, franchise analytics and visualizations are isolated from normal Anime Details.</p></div><button className="primary-button" onClick={() => navigate(`/app/anime/${malId}?view=analysis`)}>Open Deep Analysis →</button></div>
      </section>
    </div>
  )
}

export default function AnimeDetailsRoute() {
  const { id } = useParams()
  const location = useLocation()
  const malId = Number(id)
  const isAnalysis = new URLSearchParams(location.search).get('view') === 'analysis'

  if (!Number.isFinite(malId)) return <div className="page narrow-page"><div className="notice error">Invalid MAL ID.</div></div>
  if (isAnalysis) return <Suspense fallback={<div className="page deep-analysis-page"><div className="details-basic-loading"><span className="spinner" /><div><strong>Loading Deep Analysis module…</strong><small>The analytics code is downloaded only after you open this view.</small></div></div></div>}><DeepAnalysisPage malId={malId} /></Suspense>
  return <AnimeDetailsPage malId={malId} />
}
