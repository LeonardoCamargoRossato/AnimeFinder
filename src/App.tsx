import { FormEvent, useEffect, useMemo, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { animeProvider, type AnimePage } from './providers'
import {
  type Anime,
  type AnimeFilterState,
  type Genre,
  type ImportCandidate,
  type WatchedAnime,
} from './types'
import {
  catalogSearch,
  listWatched,
  removeWatched,
  saveManyWatched,
  saveWatched,
  watchedFromAnime,
} from './catalog'
import { getAuthRedirectUrl, isSupabaseConfigured, supabase } from './supabase'
import AnimeDetailsRoute from './AnimeDetailsRoute'

const AUTHORIZED_EMAIL = 'leo.c.rossato@gmail.com'
const DISCOVER_PAGE_SIZE = 12

function isAuthorized(user: User | null | undefined) {
  return user?.email?.toLowerCase() === AUTHORIZED_EMAIL
}

function App() {
  const [dark, setDark] = useState(() => localStorage.getItem('animefinder.theme') !== 'light')
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    localStorage.setItem('animefinder.theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    if (!supabase) return

    let mounted = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      setAuthReady(true)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return
      setSession(nextSession)
      setAuthReady(true)
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  return (
    <Routes>
      <Route path="/" element={<PublicHome session={session} authReady={authReady} dark={dark} setDark={setDark} />} />
      <Route path="/login" element={<LoginPage session={session} authReady={authReady} dark={dark} setDark={setDark} />} />
      <Route
        path="/app/*"
        element={
          <ProtectedApp session={session} authReady={authReady} dark={dark} setDark={setDark} />
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function PublicHome({ session, authReady, dark, setDark }: { session: Session | null; authReady: boolean; dark: boolean; setDark: (value: boolean) => void }) {
  const navigate = useNavigate()

  useEffect(() => {
    if (authReady && isAuthorized(session?.user)) navigate('/app', { replace: true })
  }, [authReady, session, navigate])

  return (
    <div className="public-shell">
      <PublicHeader dark={dark} setDark={setDark} />
      <main className="public-main">
        <section className="landing-hero">
          <div className="landing-copy">
            <span className="eyebrow">PERSONAL ANIME DISCOVERY</span>
            <h1>Find, filter and remember every anime worth watching.</h1>
            <p>
              AnimeFinder searches the MyAnimeList ecosystem through a compatible catalog provider, combines precise discovery filters,
              and keeps your watched catalog synchronized securely with Supabase.
            </p>
            <div className="landing-actions">
              <button className="primary-button landing-cta" onClick={() => navigate('/login')}>Enter AnimeFinder</button>
              <span>Private personal application</span>
            </div>
          </div>
          <div className="landing-visual" aria-hidden="true">
            <div className="visual-card visual-card-a"><span>★ 9.1</span><strong>Discover</strong><small>Search across titles</small></div>
            <div className="visual-card visual-card-b"><span>24 ep</span><strong>Filter</strong><small>Score · genre · year</small></div>
            <div className="visual-card visual-card-c"><span>✓</span><strong>Watched</strong><small>Synced with Supabase</small></div>
            <div className="visual-orbit" />
          </div>
        </section>
        <section className="landing-features">
          <article><span>01</span><h3>Search naturally</h3><p>Find anime using English, romaji, Japanese and known title variants.</p></article>
          <article><span>02</span><h3>Refine precisely</h3><p>Narrow results by score, episodes, genre, year, type, status and watched state.</p></article>
          <article><span>03</span><h3>Keep your catalog</h3><p>Your personal watched list persists through Supabase and follows your authenticated account.</p></article>
        </section>
      </main>
      <footer className="footer">AnimeFinder · Discovery powered by the MyAnimeList catalogue</footer>
    </div>
  )
}

function LoginPage({ session, authReady, dark, setDark }: { session: Session | null; authReady: boolean; dark: boolean; setDark: (value: boolean) => void }) {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const user = session?.user ?? null

  useEffect(() => {
    if (authReady && isAuthorized(user)) navigate('/app', { replace: true })
  }, [authReady, user, navigate])

  async function continueWithGoogle() {
    if (!supabase) {
      setError('Supabase is not configured for this deployment.')
      return
    }

    setError('')
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getAuthRedirectUrl(),
      },
    })
    if (authError) setError(authError.message)
  }

  if (!authReady) return <AuthLoading />
  if (user && !isAuthorized(user)) return <AccessDenied user={user} dark={dark} setDark={setDark} />

  return (
    <div className="public-shell auth-page">
      <PublicHeader dark={dark} setDark={setDark} />
      <main className="auth-main">
        <section className="auth-card">
          <span className="brand-mark auth-brand">AF</span>
          <span className="eyebrow">PRIVATE ACCESS</span>
          <h1>Enter AnimeFinder</h1>
          <p>Continue with the Google account authorized for this private catalog.</p>
          <button className="google-button" onClick={continueWithGoogle} disabled={!isSupabaseConfigured}>
            <span className="google-g">G</span>
            Continue with Google
          </button>
          {!isSupabaseConfigured && <div className="notice error">Supabase environment variables are missing.</div>}
          {error && <div className="notice error">{error}</div>}
          <button className="text-button" onClick={() => navigate('/')}>← Back to AnimeFinder</button>
        </section>
      </main>
    </div>
  )
}

function PublicHeader({ dark, setDark }: { dark: boolean; setDark: (value: boolean) => void }) {
  return (
    <header className="topbar public-topbar">
      <NavLink to="/" className="brand" aria-label="AnimeFinder home">
        <span className="brand-mark">AF</span>
        <span>AnimeFinder</span>
      </NavLink>
      <div />
      <button className="icon-button" onClick={() => setDark(!dark)} title="Toggle theme">{dark ? '☀' : '☾'}</button>
    </header>
  )
}

function AuthLoading() {
  return <div className="auth-loading"><span className="brand-mark">AF</span><p>Restoring secure session…</p></div>
}

function AccessDenied({ user, dark, setDark }: { user: User; dark: boolean; setDark: (value: boolean) => void }) {
  const navigate = useNavigate()

  async function logout() {
    await supabase?.auth.signOut()
    navigate('/', { replace: true })
  }

  return (
    <div className="public-shell auth-page">
      <PublicHeader dark={dark} setDark={setDark} />
      <main className="auth-main">
        <section className="auth-card access-denied">
          <div className="denied-icon">×</div>
          <span className="eyebrow">ACCESS DENIED</span>
          <h1>Unauthorized account</h1>
          <p>AnimeFinder is currently a private application. The signed-in account is not authorized.</p>
          <div className="signed-account">{user.email}</div>
          <button className="primary-button" onClick={logout}>Logout</button>
        </section>
      </main>
    </div>
  )
}

function ProtectedApp({ session, authReady, dark, setDark }: { session: Session | null; authReady: boolean; dark: boolean; setDark: (value: boolean) => void }) {
  if (!authReady) return <AuthLoading />
  if (!session?.user) return <Navigate to="/login" replace />
  if (!isAuthorized(session.user)) return <AccessDenied user={session.user} dark={dark} setDark={setDark} />
  return <PrivateApp user={session.user} dark={dark} setDark={setDark} />
}

function PrivateApp({ user, dark, setDark }: { user: User; dark: boolean; setDark: (value: boolean) => void }) {
  const navigate = useNavigate()
  const metadata = user.user_metadata ?? {}
  const displayName = metadata.full_name || metadata.name || user.email?.split('@')[0] || 'Leonardo'
  const avatar = metadata.avatar_url || metadata.picture

  async function logout() {
    await supabase?.auth.signOut()
    navigate('/', { replace: true })
  }

  return (
    <div className="app-shell">
      <header className="topbar private-topbar">
        <NavLink to="/app" className="brand" aria-label="AnimeFinder discover">
          <span className="brand-mark">AF</span>
          <span>AnimeFinder</span>
        </NavLink>
        <nav className="main-nav">
          <NavLink end to="/app">Discover</NavLink>
          <NavLink to="/app/my-anime">My Anime</NavLink>
          <NavLink to="/app/import">Import</NavLink>
          <NavLink to="/app/settings">Settings</NavLink>
        </nav>
        <div className="user-tools">
          <button className="icon-button" onClick={() => setDark(!dark)} title="Toggle theme">{dark ? '☀' : '☾'}</button>
          <div className="user-menu">
            {avatar ? <img src={avatar} alt="Google profile" referrerPolicy="no-referrer" /> : <span className="user-avatar-fallback">{displayName.slice(0, 1).toUpperCase()}</span>}
            <div className="user-copy"><strong>{displayName}</strong><small>{user.email}</small></div>
            <button className="logout-button" onClick={logout}>Logout</button>
          </div>
        </div>
      </header>

      <main>
        <Routes>
          <Route index element={<Discover />} />
          <Route path="my-anime" element={<MyAnime />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="anime/:id" element={<AnimeDetailsRoute />} />
          <Route path="settings" element={<Settings user={user} />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </main>

      <footer className="footer">AnimeFinder · Discovery powered by the MyAnimeList catalogue</footer>
    </div>
  )
}

function Discover() {
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [catalog, setCatalog] = useState<AnimePage | null>(null)
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<AnimeFilterState>({ watched: false })
  const [genres, setGenres] = useState<Genre[]>([])
  const [watched, setWatched] = useState<WatchedAnime[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refreshWatched = async () => setWatched(await listWatched())

  useEffect(() => {
    let live = true
    Promise.all([animeProvider.getGenres(), listWatched()])
      .then(([genreList, watchedRows]) => {
        if (!live) return
        setGenres(genreList)
        setWatched(watchedRows)
      })
      .catch((reason) => live && setError(reason instanceof Error ? reason.message : 'Could not initialize AnimeFinder.'))
    return () => { live = false }
  }, [])

  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')

    void animeProvider.browseAnime({
      query: submittedQuery || undefined,
      page,
      limit: DISCOVER_PAGE_SIZE,
      filters,
    })
      .then((nextPage) => {
        if (!live) return
        setCatalog(nextPage)
      })
      .catch((reason) => {
        if (!live) return
        setError(reason instanceof Error ? reason.message : 'Could not load the anime catalog right now.')
      })
      .finally(() => live && setLoading(false))

    return () => { live = false }
  }, [
    submittedQuery,
    page,
    filters.score_min,
    filters.score_max,
    filters.episodes_min,
    filters.episodes_max,
    filters.year,
    filters.type,
    filters.status,
    filters.watched,
    filters.genres?.join('|'),
  ])

  const watchedIds = useMemo(
    () => new Set(watched.map((row) => row.mal_id).filter((id): id is number => id != null)),
    [watched],
  )

  const providerItems = catalog?.items ?? []
  const visible = useMemo(() => providerItems.filter((anime) => {
    if (filters.watched === false && watchedIds.has(anime.malId)) return false
    if (filters.watched === true && !watchedIds.has(anime.malId)) return false
    return true
  }), [providerItems, filters.watched, watchedIds])

  function applyFilters(next: AnimeFilterState) {
    setFilters(next)
    setPage(1)
  }

  function handleSearch(event: FormEvent) {
    event.preventDefault()
    setSubmittedQuery(query.trim())
    setPage(1)
  }

  function goToPage(nextPage: number) {
    if (nextPage < 1) return
    if (nextPage > page && !catalog?.hasNextPage) return
    setPage(nextPage)
    window.setTimeout(() => document.querySelector('.results-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  async function toggleWatched(anime: Anime) {
    try {
      if (watchedIds.has(anime.malId)) await removeWatched(anime.malId)
      else await saveWatched(watchedFromAnime(anime))
      await refreshWatched()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update your catalog.')
    }
  }

  const chips = buildFilterChips(filters)
  const start = catalog && catalog.items.length ? (catalog.page - 1) * catalog.perPage + 1 : 0
  const end = catalog && catalog.items.length ? start + catalog.items.length - 1 : 0
  const rangeLabel = loading
    ? 'Loading…'
    : start
      ? `Showing ${start}–${end}${catalog?.total != null ? ` of ${catalog.total}` : ''}${visible.length !== providerItems.length ? ` · ${visible.length} visible` : ''}`
      : 'No results in this batch'

  return (
    <div className="page discover-page">
      <section className="hero">
        <div className="eyebrow">ANIME DISCOVERY ENGINE</div>
        <h1>Find your next anime</h1>
        <p>Browse the full provider catalog in small pages, refine it server-side, and keep watched series out of the way.</p>
        <form className="search-bar" onSubmit={handleSearch}>
          <span className="search-icon">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Attack on Titan, Shingeki no Kyojin, 進撃の巨人…" aria-label="Search anime" />
          <button className="primary-button" type="submit">Search</button>
        </form>
      </section>

      <section className="filters-panel">
        <div className="section-heading compact">
          <div><span className="eyebrow">REFINE FULL CATALOG</span><h2>Filters</h2></div>
          <button className="text-button" onClick={() => applyFilters({})}>Clear all</button>
        </div>
        <div className="filter-grid">
          <FilterNumber label="Min score" value={filters.score_min} min={0} max={10} step={0.1} onChange={(value) => applyFilters({ ...filters, score_min: value })} />
          <FilterNumber label="Max score" value={filters.score_max} min={0} max={10} step={0.1} onChange={(value) => applyFilters({ ...filters, score_max: value })} />
          <FilterNumber label="Min episodes" value={filters.episodes_min} min={1} onChange={(value) => applyFilters({ ...filters, episodes_min: value })} />
          <FilterNumber label="Max episodes" value={filters.episodes_max} min={1} onChange={(value) => applyFilters({ ...filters, episodes_max: value })} />
          <label className="field"><span>Genre</span><select value="" onChange={(event) => { const value = event.target.value; if (value && !filters.genres?.includes(value)) applyFilters({ ...filters, genres: [...(filters.genres ?? []), value] }) }}><option value="">Add genre…</option>{genres.map((genre) => <option key={genre.id} value={genre.name}>{genre.name}</option>)}</select></label>
          <FilterNumber label="Year" value={filters.year} min={1900} max={2100} onChange={(value) => applyFilters({ ...filters, year: value })} />
          <label className="field"><span>Type</span><select value={filters.type ?? ''} onChange={(event) => applyFilters({ ...filters, type: event.target.value || undefined })}><option value="">Any type</option><option>TV</option><option>Movie</option><option>OVA</option><option>ONA</option><option>Special</option><option>Music</option></select></label>
          <label className="field"><span>Status</span><select value={filters.status ?? ''} onChange={(event) => applyFilters({ ...filters, status: event.target.value || undefined })}><option value="">Any status</option><option>Currently Airing</option><option>Finished Airing</option><option>Not yet aired</option></select></label>
        </div>
        <div className="filter-bottom-row">
          <label className="toggle-row"><input type="checkbox" checked={filters.watched === false} onChange={(event) => applyFilters({ ...filters, watched: event.target.checked ? false : undefined })} /><span>Hide watched anime</span></label>
          <div className="chip-row">{chips.map((chip) => <button key={chip.key} className="chip" onClick={() => applyFilters(removeFilter(filters, chip.key))}>{chip.label} <b>×</b></button>)}</div>
        </div>
      </section>

      <section className="results-section">
        <div className="section-heading">
          <div><span className="eyebrow">DISCOVER</span><h2>{submittedQuery ? `Results for “${submittedQuery}”` : 'Full anime catalog'}</h2></div>
          <span className="result-count">{rangeLabel}</span>
        </div>
        {error && <div className="notice error">{error}</div>}
        {loading ? <LoadingGrid /> : visible.length ? (
          <div className="anime-grid">{visible.map((anime) => <AnimeCard key={anime.malId} anime={anime} watched={watchedIds.has(anime.malId)} onToggleWatched={() => toggleWatched(anime)} />)}</div>
        ) : providerItems.length ? (
          <EmptyState title="No visible anime in this batch" text="The current provider page is hidden by your watched filter. Use Previous or Next to keep browsing the catalog." />
        ) : (
          <EmptyState title="No anime match this catalog query" text="Remove one or more filters, or try another title." />
        )}

        <div className="filter-bottom-row" style={{ justifyContent: 'space-between', marginTop: 24 }}>
          <button className="ghost-button" disabled={page <= 1 || loading} onClick={() => goToPage(page - 1)}>← Previous</button>
          <span className="result-count">Page {catalog?.page ?? page}{catalog?.lastPage ? ` of ${catalog.lastPage}` : ''}</span>
          <button className="primary-button" disabled={!catalog?.hasNextPage || loading} onClick={() => goToPage(page + 1)}>Next →</button>
        </div>
      </section>
    </div>
  )
}

function FilterNumber({ label, value, onChange, ...props }: { label: string; value?: number; onChange: (value?: number) => void; min?: number; max?: number; step?: number }) {
  return <label className="field"><span>{label}</span><input type="number" value={value ?? ''} onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))} {...props} /></label>
}

function AnimeCard({ anime, watched, onToggleWatched }: { anime: Anime; watched: boolean; onToggleWatched: () => void }) {
  const navigate = useNavigate()
  const altTitle = anime.titleEnglish && anime.titleEnglish !== anime.title ? anime.titleEnglish : anime.titleJapanese
  return (
    <article className="anime-card">
      <button className="poster-button" onClick={() => navigate(`/app/anime/${anime.malId}`)} aria-label={`Open ${anime.title}`}>
        {anime.imageUrl ? <img src={anime.imageUrl} alt={anime.title} loading="lazy" /> : <div className="poster-placeholder">No image</div>}
        <span className="score-badge">★ {anime.score?.toFixed(1) ?? '—'}</span>
      </button>
      <div className="anime-card-body">
        <div className="card-meta"><span>{anime.type ?? 'Anime'}</span><span>{anime.year ?? '—'}</span><span>{anime.episodes ? `${anime.episodes} ep` : 'Episodes —'}</span></div>
        <button className="title-button" onClick={() => navigate(`/app/anime/${anime.malId}`)}>{anime.title}</button>
        {altTitle && <div className="alt-title">{altTitle}</div>}
        <div className="genre-row">{anime.genres.slice(0, 3).map((genre) => <span key={genre.id}>{genre.name}</span>)}</div>
        <div className="card-footer"><span className={`status-dot ${anime.status === 'Currently Airing' ? 'live' : ''}`}>{anime.status ?? 'Unknown'}</span><button className={watched ? 'watched-button active' : 'watched-button'} onClick={onToggleWatched}>{watched ? '✓ Watched' : '+ Watched'}</button></div>
      </div>
    </article>
  )
}

function MyAnime() {
  const [rows, setRows] = useState<WatchedAnime[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = async () => {
    try { setRows(await listWatched()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load your catalog.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])
  const visible = catalogSearch(rows, query)

  return (
    <div className="page narrow-page">
      <PageIntro eyebrow="PERSONAL CATALOG" title="My Anime" text="Everything you have marked as watched, searchable across every stored title variant." />
      <div className="catalog-toolbar"><input className="standalone-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your catalog in any language…" /><span>{visible.length} anime</span></div>
      {error && <div className="notice error">{error}</div>}
      {loading ? <div className="notice">Loading your catalog…</div> : visible.length ? <div className="catalog-list">{visible.map((row) => (
        <article className="catalog-item" key={`${row.id}-${row.mal_id}`}>
          <div className="catalog-index">{row.mal_id ?? '—'}</div>
          <div className="catalog-copy"><h3>{row.title_original}</h3><p>{[row.title_english, row.title_romaji, row.title_japanese, row.title_portuguese, row.title_chinese].filter(Boolean).filter((title, index, array) => array.indexOf(title) === index).join(' · ') || 'No alternative titles stored yet'}</p></div>
          <span className="match-pill">{row.match_status.replace('_', ' ')}</span>
          {row.mal_id && <button className="ghost-button" onClick={async () => { await removeWatched(row.mal_id!); await refresh() }}>Remove</button>}
        </article>
      ))}</div> : <EmptyState title="Your catalog is empty" text="Mark anime as watched from Discover, or import your existing list." action="Import a list" href="/app/import" />}
    </div>
  )
}

function ImportPage() {
  const [text, setText] = useState('')
  const [candidates, setCandidates] = useState<ImportCandidate[]>([])
  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({})
  const [processing, setProcessing] = useState(false)
  const [message, setMessage] = useState('')

  async function searchCandidate(candidate: ImportCandidate, term: string) {
    setCandidates((rows) => rows.map((row) => row.key === candidate.key ? { ...row, loading: true } : row))
    try {
      const matches = await animeProvider.searchAnime(term)
      setCandidates((rows) => rows.map((row) => row.key === candidate.key ? { ...row, loading: false, match: matches[0] ?? null, alternatives: matches.slice(0, 8), status: matches.length ? 'uncertain' : 'unmatched' } : row))
    } catch {
      setCandidates((rows) => rows.map((row) => row.key === candidate.key ? { ...row, loading: false, match: null, alternatives: [], status: 'unmatched' } : row))
    }
  }

  async function processList() {
    const titles = Array.from(new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)))
    const seed: ImportCandidate[] = titles.map((title, index) => ({ key: `${index}-${title}`, originalTitle: title, status: 'unmatched', loading: true }))
    setCandidates(seed)
    setSearchTerms(Object.fromEntries(seed.map((row) => [row.key, row.originalTitle])))
    setProcessing(true)
    setMessage('')
    for (const row of seed) {
      await searchCandidate(row, row.originalTitle)
      await new Promise((resolve) => setTimeout(resolve, 380))
    }
    setProcessing(false)
  }

  function chooseMatch(key: string, malId: number) {
    setCandidates((rows) => rows.map((row) => row.key === key ? { ...row, match: row.alternatives?.find((anime) => anime.malId === malId) ?? row.match, status: 'uncertain' } : row))
  }

  async function saveConfirmed() {
    const confirmed = candidates.filter((row) => row.status === 'manually_confirmed' && row.match)
    try {
      await saveManyWatched(confirmed.map((row) => watchedFromAnime(row.match!, row.originalTitle)))
      setMessage(`${confirmed.length} confirmed anime saved to your Supabase catalog.`)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Could not save the confirmed anime.')
    }
  }

  return (
    <div className="page narrow-page">
      <PageIntro eyebrow="LIST MIGRATION" title="Import your anime list" text="Paste your Evernote list below. Every title is checked against MyAnimeList, but nothing uncertain is saved without your confirmation." />
      <section className="import-box">
        <label className="field"><span>One anime title per line</span><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={'Naruto\nDeath Note\nShingeki no Kyojin\nSteins;Gate\nFullmetal Alchemist Brotherhood'} /></label>
        <div className="import-actions"><span>{text.split(/\r?\n/).filter((line) => line.trim()).length} titles detected</span><button className="primary-button" disabled={!text.trim() || processing} onClick={processList}>{processing ? 'Processing…' : 'Process List'}</button></div>
      </section>

      {candidates.length > 0 && <section className="import-results">
        <div className="section-heading"><div><span className="eyebrow">MATCH REVIEW</span><h2>Confirm each match</h2></div><button className="primary-button" disabled={!candidates.some((row) => row.status === 'manually_confirmed')} onClick={saveConfirmed}>Save confirmed</button></div>
        {message && <div className="notice success">{message}</div>}
        <div className="import-table-wrap"><table className="import-table"><thead><tr><th>Original title</th><th>Possible MAL match</th><th>MAL ID</th><th>Score</th><th>Match status</th><th>Actions</th></tr></thead><tbody>{candidates.map((row) => <tr key={row.key}><td><strong>{row.originalTitle}</strong><div className="inline-search"><input value={searchTerms[row.key] ?? ''} onChange={(event) => setSearchTerms({ ...searchTerms, [row.key]: event.target.value })} /><button onClick={() => searchCandidate(row, searchTerms[row.key] || row.originalTitle)}>Search</button></div></td><td>{row.loading ? 'Searching…' : row.alternatives?.length ? <select value={row.match?.malId ?? ''} onChange={(event) => chooseMatch(row.key, Number(event.target.value))}>{row.alternatives.map((anime) => <option key={anime.malId} value={anime.malId}>{anime.title}{anime.year ? ` (${anime.year})` : ''}</option>)}</select> : 'No match found'}</td><td>{row.match?.malId ?? '—'}</td><td>{row.match?.score?.toFixed(1) ?? '—'}</td><td><span className={`match-pill ${row.status}`}>{row.status.replace('_', ' ')}</span></td><td><div className="row-actions"><button onClick={() => setCandidates((rows) => rows.map((item) => item.key === row.key ? { ...item, status: 'manually_confirmed' } : item))} disabled={!row.match}>Confirm</button><button onClick={() => setCandidates((rows) => rows.map((item) => item.key === row.key ? { ...item, match: null, status: 'unmatched' } : item))}>Reject</button></div></td></tr>)}</tbody></table></div>
      </section>}
    </div>
  )
}

function Settings({ user }: { user: User }) {
  return (
    <div className="page narrow-page">
      <PageIntro eyebrow="CONFIGURATION" title="Settings" text="Review the services and authenticated account that power AnimeFinder." />
      <section className="settings-card"><div><span className="eyebrow">ANIME DATA SOURCES</span><h2>Providers</h2></div><div className="provider-row"><div className="provider-logo">MAL</div><div><strong>MyAnimeList catalogue / Tenrai</strong><p>Full-catalog search, provider-side filters, details, genres, seasons and rankings.</p></div><span className="active-pill">● Active</span></div><div className="coming-soon">Provider abstraction remains ready for additional data sources.</div></section>
      <section className="settings-card"><div><span className="eyebrow">AUTHENTICATION & STORAGE</span><h2>Supabase</h2></div><div className="provider-row"><div className="provider-logo">DB</div><div><strong>Connected and persistent</strong><p>Google identity is handled by Supabase Auth. Your watched catalog is stored in the dedicated <code>animefinder</code> schema.</p></div><span className="active-pill">● Connected</span></div><div className="session-summary"><span>Signed in as</span><strong>{user.email}</strong><small>RLS independently restricts the catalog to this authorized account.</small></div></section>
    </div>
  )
}

function PageIntro({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <section className="page-intro"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{text}</p></section>
}

function EmptyState({ title, text, action, href }: { title: string; text: string; action?: string; href?: string }) {
  const navigate = useNavigate()
  return <div className="empty-state"><div className="empty-symbol">✦</div><h3>{title}</h3><p>{text}</p>{action && href && <button className="primary-button" onClick={() => navigate(href)}>{action}</button>}</div>
}

function LoadingGrid() {
  return <div className="anime-grid">{Array.from({ length: DISCOVER_PAGE_SIZE }).map((_, index) => <div className="anime-card skeleton-card" key={index}><div className="skeleton poster-skeleton" /><div className="anime-card-body"><div className="skeleton line wide" /><div className="skeleton line" /><div className="skeleton line small" /></div></div>)}</div>
}

function buildFilterChips(filters: AnimeFilterState) {
  const chips: { key: string; label: string }[] = []
  if (filters.score_min != null) chips.push({ key: 'score_min', label: `Score ≥ ${filters.score_min}` })
  if (filters.score_max != null) chips.push({ key: 'score_max', label: `Score ≤ ${filters.score_max}` })
  if (filters.episodes_min != null) chips.push({ key: 'episodes_min', label: `Episodes ≥ ${filters.episodes_min}` })
  if (filters.episodes_max != null) chips.push({ key: 'episodes_max', label: `Episodes ≤ ${filters.episodes_max}` })
  if (filters.year != null) chips.push({ key: 'year', label: `Year: ${filters.year}` })
  if (filters.type) chips.push({ key: 'type', label: `Type: ${filters.type}` })
  if (filters.status) chips.push({ key: 'status', label: filters.status })
  filters.genres?.forEach((genre) => chips.push({ key: `genre:${genre}`, label: `Genre: ${genre}` }))
  if (filters.watched === false) chips.push({ key: 'watched', label: 'Not watched' })
  if (filters.watched === true) chips.push({ key: 'watched', label: 'Watched' })
  return chips
}

function removeFilter(filters: AnimeFilterState, key: string): AnimeFilterState {
  if (key.startsWith('genre:')) return { ...filters, genres: filters.genres?.filter((genre) => genre !== key.slice(6)) }
  return { ...filters, [key]: undefined }
}

export default App