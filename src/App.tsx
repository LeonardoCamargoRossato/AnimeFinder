import { FormEvent, useEffect, useMemo, useState } from 'react'
import { NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { animeProvider } from './providers'
import {
  animeMatchesFilters,
  type Anime,
  type AnimeFilterState,
  type Genre,
  type ImportCandidate,
  type WatchedAnime,
} from './types'
import {
  catalogSearch,
  getCatalogMode,
  listWatched,
  removeWatched,
  saveManyWatched,
  saveWatched,
  watchedFromAnime,
} from './catalog'
import { isSupabaseConfigured, supabase } from './supabase'

function App() {
  const [dark, setDark] = useState(() => localStorage.getItem('animefinder.theme') !== 'light')

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    localStorage.setItem('animefinder.theme', dark ? 'dark' : 'light')
  }, [dark])

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="AnimeFinder home">
          <span className="brand-mark">AF</span>
          <span>AnimeFinder</span>
        </NavLink>
        <nav className="main-nav">
          <NavLink to="/">Discover</NavLink>
          <NavLink to="/my-anime">My Anime</NavLink>
          <NavLink to="/import">Import</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <button className="icon-button" onClick={() => setDark((value) => !value)} title="Toggle theme">
          {dark ? '☀' : '☾'}
        </button>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<Discover />} />
          <Route path="/my-anime" element={<MyAnime />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/anime/:id" element={<AnimeDetails />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>

      <footer className="footer">AnimeFinder · Discovery powered by MyAnimeList data via Jikan</footer>
    </div>
  )
}

function Discover() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Anime[]>([])
  const [filters, setFilters] = useState<AnimeFilterState>({ watched: false })
  const [genres, setGenres] = useState<Genre[]>([])
  const [watched, setWatched] = useState<WatchedAnime[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refreshWatched = async () => setWatched(await listWatched())

  useEffect(() => {
    let live = true
    Promise.all([animeProvider.getTopAnime(), animeProvider.getGenres(), listWatched()])
      .then(([anime, genreList, watchedRows]) => {
        if (!live) return
        setResults(anime)
        setGenres(genreList)
        setWatched(watchedRows)
      })
      .catch(() => live && setError('Could not load anime data right now. Please try again.'))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [])

  const watchedIds = useMemo(
    () => new Set(watched.map((row) => row.mal_id).filter((id): id is number => id != null)),
    [watched],
  )

  const visible = useMemo(
    () => results.filter((anime) => animeMatchesFilters(anime, filters, watchedIds)),
    [results, filters, watchedIds],
  )

  async function handleSearch(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      setResults(query.trim() ? await animeProvider.searchAnime(query.trim()) : await animeProvider.getTopAnime())
    } catch {
      setError('Search failed. Jikan may be temporarily rate-limited; try again in a moment.')
    } finally {
      setLoading(false)
    }
  }

  async function toggleWatched(anime: Anime) {
    if (watchedIds.has(anime.malId)) await removeWatched(anime.malId)
    else await saveWatched(watchedFromAnime(anime))
    await refreshWatched()
  }

  const chips = buildFilterChips(filters)

  return (
    <div className="page discover-page">
      <section className="hero">
        <div className="eyebrow">ANIME DISCOVERY ENGINE</div>
        <h1>Find your next anime</h1>
        <p>Search across titles, narrow the catalog with precise filters, and keep watched series out of the way.</p>
        <form className="search-bar" onSubmit={handleSearch}>
          <span className="search-icon">⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Attack on Titan, Shingeki no Kyojin, 進撃の巨人…"
            aria-label="Search anime"
          />
          <button className="primary-button" type="submit">Search</button>
        </form>
      </section>

      <section className="filters-panel">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">REFINE RESULTS</span>
            <h2>Filters</h2>
          </div>
          <button className="text-button" onClick={() => setFilters({})}>Clear all</button>
        </div>
        <div className="filter-grid">
          <FilterNumber label="Min score" value={filters.score_min} min={0} max={10} step={0.1} onChange={(value) => setFilters({ ...filters, score_min: value })} />
          <FilterNumber label="Max score" value={filters.score_max} min={0} max={10} step={0.1} onChange={(value) => setFilters({ ...filters, score_max: value })} />
          <FilterNumber label="Min episodes" value={filters.episodes_min} min={1} onChange={(value) => setFilters({ ...filters, episodes_min: value })} />
          <FilterNumber label="Max episodes" value={filters.episodes_max} min={1} onChange={(value) => setFilters({ ...filters, episodes_max: value })} />
          <label className="field"><span>Genre</span><select value="" onChange={(event) => {
            const value = event.target.value
            if (value && !filters.genres?.includes(value)) setFilters({ ...filters, genres: [...(filters.genres ?? []), value] })
          }}><option value="">Add genre…</option>{genres.map((genre) => <option key={genre.id} value={genre.name}>{genre.name}</option>)}</select></label>
          <FilterNumber label="Year" value={filters.year} min={1900} max={2100} onChange={(value) => setFilters({ ...filters, year: value })} />
          <label className="field"><span>Type</span><select value={filters.type ?? ''} onChange={(event) => setFilters({ ...filters, type: event.target.value || undefined })}><option value="">Any type</option><option>TV</option><option>Movie</option><option>OVA</option><option>ONA</option><option>Special</option><option>Music</option></select></label>
          <label className="field"><span>Status</span><select value={filters.status ?? ''} onChange={(event) => setFilters({ ...filters, status: event.target.value || undefined })}><option value="">Any status</option><option>Currently Airing</option><option>Finished Airing</option><option>Not yet aired</option></select></label>
        </div>
        <div className="filter-bottom-row">
          <label className="toggle-row"><input type="checkbox" checked={filters.watched === false} onChange={(event) => setFilters({ ...filters, watched: event.target.checked ? false : undefined })} /><span>Hide watched anime</span></label>
          <div className="chip-row">
            {chips.map((chip) => <button key={chip.key} className="chip" onClick={() => setFilters(removeFilter(filters, chip.key))}>{chip.label} <b>×</b></button>)}
          </div>
        </div>
      </section>

      <section className="results-section">
        <div className="section-heading">
          <div><span className="eyebrow">DISCOVER</span><h2>{query.trim() ? `Results for “${query.trim()}”` : 'Popular anime'}</h2></div>
          <span className="result-count">{visible.length} shown</span>
        </div>
        {error && <div className="notice error">{error}</div>}
        {loading ? <LoadingGrid /> : visible.length ? (
          <div className="anime-grid">{visible.map((anime) => <AnimeCard key={anime.malId} anime={anime} watched={watchedIds.has(anime.malId)} onToggleWatched={() => toggleWatched(anime)} />)}</div>
        ) : <EmptyState title="No anime match these filters" text="Remove one or more filters, or try another title." />}
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
      <button className="poster-button" onClick={() => navigate(`/anime/${anime.malId}`)} aria-label={`Open ${anime.title}`}>
        {anime.imageUrl ? <img src={anime.imageUrl} alt={anime.title} loading="lazy" /> : <div className="poster-placeholder">No image</div>}
        <span className="score-badge">★ {anime.score?.toFixed(1) ?? '—'}</span>
      </button>
      <div className="anime-card-body">
        <div className="card-meta"><span>{anime.type ?? 'Anime'}</span><span>{anime.year ?? '—'}</span><span>{anime.episodes ? `${anime.episodes} ep` : 'Episodes —'}</span></div>
        <button className="title-button" onClick={() => navigate(`/anime/${anime.malId}`)}>{anime.title}</button>
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

  const refresh = async () => {
    setRows(await listWatched())
    setLoading(false)
  }
  useEffect(() => { void refresh() }, [])
  const visible = catalogSearch(rows, query)

  return (
    <div className="page narrow-page">
      <PageIntro eyebrow="PERSONAL CATALOG" title="My Anime" text="Everything you have marked as watched, searchable across every stored title variant." />
      <div className="catalog-toolbar"><input className="standalone-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your catalog in any language…" /><span>{visible.length} anime</span></div>
      {loading ? <div className="notice">Loading your catalog…</div> : visible.length ? <div className="catalog-list">{visible.map((row) => (
        <article className="catalog-item" key={`${row.id}-${row.mal_id}`}>
          <div className="catalog-index">{row.mal_id ?? '—'}</div>
          <div className="catalog-copy"><h3>{row.title_original}</h3><p>{[row.title_english, row.title_romaji, row.title_japanese, row.title_portuguese, row.title_chinese].filter(Boolean).filter((title, index, array) => array.indexOf(title) === index).join(' · ') || 'No alternative titles stored yet'}</p></div>
          <span className="match-pill">{row.match_status.replace('_', ' ')}</span>
          {row.mal_id && <button className="ghost-button" onClick={async () => { await removeWatched(row.mal_id!); await refresh() }}>Remove</button>}
        </article>
      ))}</div> : <EmptyState title="Your catalog is empty" text="Mark anime as watched from Discover, or import your existing list." action="Import a list" href="/import" />}
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
    await saveManyWatched(confirmed.map((row) => watchedFromAnime(row.match!, row.originalTitle)))
    setMessage(`${confirmed.length} confirmed anime saved to your catalog.`)
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

function AnimeDetails() {
  const { id } = useParams()
  const [anime, setAnime] = useState<Anime | null>(null)
  const [watched, setWatched] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const malId = Number(id)
    if (!Number.isFinite(malId)) return
    Promise.all([animeProvider.getAnime(malId), listWatched()])
      .then(([item, rows]) => {
        setAnime(item)
        setWatched(rows.some((row) => row.mal_id === malId))
      })
      .catch(() => setError('Could not load this anime.'))
  }, [id])

  if (error) return <div className="page narrow-page"><div className="notice error">{error}</div></div>
  if (!anime) return <div className="page narrow-page"><div className="notice">Loading anime details…</div></div>

  return (
    <div className="page details-page">
      <button className="text-button back-button" onClick={() => navigate(-1)}>← Back</button>
      <section className="details-hero">
        <div className="details-poster">{anime.largeImageUrl || anime.imageUrl ? <img src={anime.largeImageUrl || anime.imageUrl!} alt={anime.title} /> : null}</div>
        <div className="details-copy">
          <div className="eyebrow">MAL #{anime.malId}</div>
          <h1>{anime.title}</h1>
          {anime.titleEnglish && anime.titleEnglish !== anime.title && <h2>{anime.titleEnglish}</h2>}
          {anime.titleJapanese && <div className="japanese-title">{anime.titleJapanese}</div>}
          <div className="detail-stats"><div><b>★ {anime.score?.toFixed(1) ?? '—'}</b><span>Score</span></div><div><b>{anime.episodes ?? '—'}</b><span>Episodes</span></div><div><b>{anime.type ?? '—'}</b><span>Type</span></div><div><b>{anime.year ?? '—'}</b><span>Year</span></div></div>
          <div className="genre-row large">{anime.genres.map((genre) => <span key={genre.id}>{genre.name}</span>)}</div>
          <p className="synopsis">{anime.synopsis || 'No synopsis available.'}</p>
          <div className="details-actions"><button className={watched ? 'primary-button watched-primary' : 'primary-button'} onClick={async () => { if (watched) await removeWatched(anime.malId); else await saveWatched(watchedFromAnime(anime)); setWatched(!watched) }}>{watched ? '✓ Watched' : '+ Mark as watched'}</button>{anime.url && <a className="ghost-button link-button" href={anime.url} target="_blank" rel="noreferrer">Open on MyAnimeList ↗</a>}</div>
        </div>
      </section>
      <section className="title-variants"><div className="section-heading compact"><div><span className="eyebrow">IDENTIFICATION</span><h2>Known title variants</h2></div></div><div className="variant-grid">{anime.titles.map((title, index) => <div key={`${title.type}-${index}`}><span>{title.type}</span><strong>{title.title}</strong></div>)}</div></section>
    </div>
  )
}

function Settings() {
  const [mode, setMode] = useState<'supabase' | 'local'>('local')
  const [email, setEmail] = useState('')
  const [authMessage, setAuthMessage] = useState('')

  useEffect(() => { void getCatalogMode().then(setMode) }, [])

  async function sendMagicLink(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !email) return
    const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}#/settings`
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } })
    setAuthMessage(error ? error.message : 'Check your email for the secure sign-in link.')
  }

  return (
    <div className="page narrow-page">
      <PageIntro eyebrow="CONFIGURATION" title="Settings" text="Manage the data sources and storage services that power AnimeFinder." />
      <section className="settings-card"><div><span className="eyebrow">ANIME DATA SOURCES</span><h2>Providers</h2></div><div className="provider-row"><div className="provider-logo">MAL</div><div><strong>MyAnimeList / Jikan</strong><p>Search, details, genres, seasons and rankings.</p></div><span className="active-pill">● Active</span></div><div className="coming-soon">More data sources coming later.</div></section>
      <section className="settings-card"><div><span className="eyebrow">PERSONAL CATALOG</span><h2>Storage</h2></div><div className="provider-row"><div className="provider-logo">DB</div><div><strong>{mode === 'supabase' ? 'Supabase connected' : 'Browser storage'}</strong><p>{mode === 'supabase' ? 'Your watched catalog is synchronized with your authenticated Supabase account.' : 'Your catalog is currently stored only in this browser. Supabase can be enabled without changing the app.'}</p></div><span className={mode === 'supabase' ? 'active-pill' : 'local-pill'}>{mode === 'supabase' ? '● Connected' : 'Local mode'}</span></div>
        {!isSupabaseConfigured && <div className="notice">Supabase environment variables have not been configured for this deployment yet.</div>}
        {isSupabaseConfigured && mode === 'local' && <form className="auth-form" onSubmit={sendMagicLink}><p>Sign in to synchronize your catalog securely.</p><div className="inline-form"><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Your Supabase account email" /><button className="primary-button">Send sign-in link</button></div>{authMessage && <small>{authMessage}</small>}</form>}
      </section>
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
  return <div className="anime-grid">{Array.from({ length: 8 }).map((_, index) => <div className="anime-card skeleton-card" key={index}><div className="skeleton poster-skeleton" /><div className="anime-card-body"><div className="skeleton line wide" /><div className="skeleton line" /><div className="skeleton line small" /></div></div>)}</div>
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
