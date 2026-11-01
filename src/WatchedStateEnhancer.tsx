import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { isPersonalCatalogWatched } from './personalCatalog'

export default function WatchedStateEnhancer() {
  const location = useLocation()
  const match = location.pathname.match(/^\/app\/anime\/(\d+)$/)
  const malId = match ? Number(match[1]) : null

  useEffect(() => {
    if (!malId || !isPersonalCatalogWatched(malId)) return

    const sync = () => {
      const button = document.querySelector('.details-v2-actions > button.primary-button') as HTMLButtonElement | null
      if (!button) return
      button.textContent = '✓ Watched'
      button.classList.add('watched-primary')
      button.disabled = true
      button.title = 'Watched · confirmed by your Personal Catalog'
      button.setAttribute('aria-label', 'Watched')
    }

    sync()
    const observer = new MutationObserver(sync)
    const root = document.getElementById('root')
    if (root) observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [malId])

  return null
}
