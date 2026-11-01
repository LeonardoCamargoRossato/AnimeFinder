import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export default function WishlistWatchedLockEnhancer() {
  const location = useLocation()

  useEffect(() => {
    if (!/^\/app\/anime\/\d+$/.test(location.pathname)) return
    let frame = 0

    const sync = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const actions = document.querySelector('.details-v2-actions') as HTMLElement | null
        if (!actions) return
        const watchedButton = actions.querySelector('.watched-primary') as HTMLButtonElement | null
        const wishlistButton = actions.querySelector('.wishlist-trigger') as HTMLButtonElement | null
        if (!wishlistButton) return

        const locked = Boolean(watchedButton && watchedButton.textContent?.includes('Watched'))
        const alreadyLocked = wishlistButton.dataset.watchedLocked === 'true'

        if (locked && !alreadyLocked) {
          wishlistButton.disabled = true
          wishlistButton.dataset.watchedLocked = 'true'
          wishlistButton.textContent = '🔒 Want to Watch'
          wishlistButton.title = 'Already watched — this anime cannot be added to Want to Watch.'
          wishlistButton.classList.add('watched-locked')
          actions.querySelector('.wishlist-picker')?.remove()
        } else if (!locked && alreadyLocked) {
          wishlistButton.disabled = false
          delete wishlistButton.dataset.watchedLocked
          wishlistButton.textContent = wishlistButton.classList.contains('active') ? '✓ Want to Watch' : '+ Want to Watch'
          wishlistButton.removeAttribute('title')
          wishlistButton.classList.remove('watched-locked')
        }
      })
    }

    sync()
    const observer = new MutationObserver(sync)
    const root = document.getElementById('root')
    if (root) observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [location.pathname])

  return null
}
