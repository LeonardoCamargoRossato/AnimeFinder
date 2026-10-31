import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { animeProvider } from './providers'
import {
  addAnimeToWishlist,
  createWishlist,
  listAnimeWishlistMembership,
  listWishlistItems,
  listWishlists,
  removeAnimeFromWishlist,
  type Wishlist,
  type WishlistItem,
} from './wishlists'

function usePortalHost(selector: string, className: string, enabled = true, beforeSelector?: string) {
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setHost(null)
    if (!enabled) return

    let mountedHost: HTMLDivElement | null = null

    const syncHost = () => {
      const target = document.querySelector(selector)
      if (!target) return

      const existing = target.querySelector(`:scope > .${className}`) as HTMLDivElement | null
      if (existing) {
        mountedHost = existing
        setHost(existing)
        return
      }

      const nextHost = document.createElement('div')
      nextHost.className = className
      const before = beforeSelector ? target.querySelector(beforeSelector) : null
      target.insertBefore(nextHost, before)
      mountedHost = nextHost
      setHost(nextHost)
    }

    syncHost()
    const observer = new MutationObserver(syncHost)
    const root = document.getElementById('root')
    if (root) observer.observe(root, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      mountedHost?.remove()
    }
  }, [selector, className, enabled, beforeSelector])

  return host
}

function WishlistButton({ malId }: { malId: number }) {
  const [lists, setLists] = useState<Wishlist[]>([])
  const [membership, setMembership] = useState<WishlistItem[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function refresh() {
    const [nextLists, nextMembership] = await Promise.all([
      listWishlists(),
      listAnimeWishlistMembership(malId),
    ])
    setLists(nextLists)
    setMembership(nextMembership)
    const preferred = nextLists.find((list) => list.is_default) ?? nextLists[0]
    setSelectedId((current) => current ?? preferred?.id ?? null)
  }

  useEffect(() => {
    setError('')
    void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load wishlists.'))
  }, [malId])

  const selectedMembership = membership.some((item) => item.wishlist_id === selectedId)

  async function addToSelected() {
    if (!selectedId) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const anime = await animeProvider.getAnime(malId)
      await addAnimeToWishlist(selectedId, anime)
      await refresh()
      const listName = lists.find((list) => list.id === selectedId)?.name ?? 'wishlist'
      setMessage(`Added to ${listName}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add this anime to the wishlist.')
    } finally {
      setBusy(false)
    }
  }

  async function createAndAdd() {
    if (!newName.trim()) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const [created, anime] = await Promise.all([createWishlist(newName), animeProvider.getAnime(malId)])
      await addAnimeToWishlist(created.id, anime)
      setNewName('')
      setSelectedId(created.id)
      await refresh()
      setMessage(`Added to ${created.name}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create this wishlist.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wishlist-action-wrap">
      <button
        className={membership.length ? 'ghost-button wishlist-trigger active' : 'ghost-button wishlist-trigger'}
        onClick={() => setOpen((value) => !value)}
      >
        {membership.length ? '✓ Want to Watch' : '+ Want to Watch'}
      </button>

      {open && (
        <div className="wishlist-picker" role="dialog" aria-label="Choose a wishlist">
          <div className="wishlist-picker-heading">
            <div><span className="eyebrow">WISHLIST</span><strong>Choose a list</strong></div>
            <button className="wishlist-picker-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>

          {error && <div className="wishlist-inline-error">{error}</div>}
          {message && <div className="wishlist-inline-success">{message}</div>}

          {lists.length > 0 && (
            <>
              <label className="wishlist-picker-field">
                <span>Add to</span>
                <select value={selectedId ?? ''} onChange={(event) => setSelectedId(Number(event.target.value))}>
                  {lists.map((list) => <option key={list.id} value={list.id}>{list.name}{list.is_default ? ' · default' : ''}</option>)}
                </select>
              </label>
              <button className="primary-button wishlist-add-button" disabled={busy || !selectedId || selectedMembership} onClick={addToSelected}>
                {selectedMembership ? 'Already in this list' : busy ? 'Adding…' : 'Add to list'}
              </button>
            </>
          )}

          <div className="wishlist-create-divider"><span>New wishlist</span></div>
          <div className="wishlist-create-row">
            <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. Short anime" maxLength={80} />
            <button className="ghost-button" disabled={busy || !newName.trim()} onClick={createAndAdd}>Create + add</button>
          </div>
          <small className="wishlist-picker-note">If you keep the default selection, the anime is added to “Want to Watch Favorites”.</small>
        </div>
      )}
    </div>
  )
}

function WishlistPosterCard({ item, onRemove }: { item: WishlistItem; onRemove: () => void }) {
  const navigate = useNavigate()
  return (
    <article className="anime-card wishlist-poster-card">
      <button className="poster-button" onClick={() => navigate(`/app/anime/${item.mal_id}`)} aria-label={`Open ${item.title}`}>
        {item.image_url ? <img src={item.image_url} alt={item.title} loading="lazy" /> : <div className="poster-placeholder">No image</div>}
        <span className="score-badge">★ {item.score?.toFixed(1) ?? '—'}</span>
      </button>
      <div className="anime-card-body">
        <div className="card-meta"><span>{item.type ?? 'Anime'}</span><span>{item.year ?? '—'}</span><span>{item.episodes ? `${item.episodes} ep` : 'Episodes —'}</span></div>
        <button className="title-button" onClick={() => navigate(`/app/anime/${item.mal_id}`)}>{item.title}</button>
        {item.title_english && item.title_english !== item.title && <div className="alt-title">{item.title_english}</div>}
        <div className="wishlist-card-footer">
          <span className="status-dot">{item.status ?? 'Saved'}</span>
          <button className="wishlist-remove-button" onClick={onRemove}>Remove</button>
        </div>
      </div>
    </article>
  )
}

function MyListsPage() {
  const [lists, setLists] = useState<Wishlist[]>([])
  const [items, setItems] = useState<WishlistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  async function refresh() {
    setError('')
    try {
      const [nextLists, nextItems] = await Promise.all([listWishlists(), listWishlistItems()])
      setLists(nextLists)
      setItems(nextItems)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load your wishlists.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  const grouped = useMemo(() => new Map(lists.map((list) => [list.id, items.filter((item) => item.wishlist_id === list.id)])), [lists, items])

  async function createList() {
    if (!newName.trim()) return
    setCreating(true)
    try {
      await createWishlist(newName)
      setNewName('')
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create the wishlist.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="page my-lists-page">
      <section className="page-intro my-lists-intro">
        <span className="eyebrow">WISHLISTS</span>
        <h1>My Lists</h1>
        <p>Keep anime you want to watch organized into personal wishlists.</p>
      </section>

      <section className="wishlist-create-panel">
        <div><span className="eyebrow">CREATE</span><h2>New wishlist</h2></div>
        <div className="wishlist-create-toolbar">
          <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Wishlist name…" maxLength={80} />
          <button className="primary-button" disabled={creating || !newName.trim()} onClick={createList}>{creating ? 'Creating…' : '+ Create wishlist'}</button>
        </div>
      </section>

      {error && <div className="notice error">{error}</div>}
      {loading ? <div className="notice">Loading your lists…</div> : lists.length ? lists.map((list) => {
        const listItems = grouped.get(list.id) ?? []
        return (
          <section className="wishlist-section" key={list.id}>
            <div className="section-heading">
              <div><span className="eyebrow">{list.is_default ? 'DEFAULT LIST' : 'WISHLIST'}</span><h2>{list.name}</h2></div>
              <span className="result-count">{listItems.length} anime</span>
            </div>
            {listItems.length ? (
              <div className="anime-grid wishlist-grid">
                {listItems.map((item) => <WishlistPosterCard key={item.id} item={item} onRemove={async () => { await removeAnimeFromWishlist(list.id, item.mal_id); await refresh() }} />)}
              </div>
            ) : (
              <div className="wishlist-empty">No anime in this wishlist yet. Open an anime and choose <strong>Want to Watch</strong>.</div>
            )}
          </section>
        )
      }) : <div className="wishlist-empty">No wishlists yet.</div>}
    </div>
  )
}

export default function WishlistEnhancer() {
  const location = useLocation()
  const navigate = useNavigate()
  const detailsMatch = location.pathname.match(/^\/app\/anime\/(\d+)$/)
  const malId = detailsMatch ? Number(detailsMatch[1]) : null
  const isMyLists = location.pathname === '/app' && new URLSearchParams(location.search).get('view') === 'my-lists'

  const navHost = usePortalHost('.main-nav', 'wishlist-nav-host', location.pathname.startsWith('/app'))
  const detailsHost = usePortalHost('.details-actions', 'wishlist-action-host', Boolean(malId), '.link-button')
  const [pageHost, setPageHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setPageHost(null)
    if (!isMyLists) return

    let mountedHost: HTMLDivElement | null = null
    let hiddenPage: HTMLElement | null = null

    const sync = () => {
      const main = document.querySelector('.app-shell > main') as HTMLElement | null
      if (!main) return

      hiddenPage = Array.from(main.children).find((child) => child.classList.contains('page') && !child.classList.contains('wishlist-page-host')) as HTMLElement | null
      if (hiddenPage) hiddenPage.style.display = 'none'

      const existing = main.querySelector(':scope > .wishlist-page-host') as HTMLDivElement | null
      if (existing) {
        mountedHost = existing
        setPageHost(existing)
        return
      }

      const host = document.createElement('div')
      host.className = 'wishlist-page-host'
      main.appendChild(host)
      mountedHost = host
      setPageHost(host)
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
  }, [isMyLists])

  return (
    <>
      {navHost && createPortal(
        <button className={isMyLists ? 'wishlist-nav-link active' : 'wishlist-nav-link'} onClick={() => navigate('/app?view=my-lists')}>My Lists</button>,
        navHost,
      )}
      {detailsHost && malId && createPortal(<WishlistButton malId={malId} />, detailsHost)}
      {pageHost && isMyLists && createPortal(<MyListsPage />, pageHost)}
    </>
  )
}
