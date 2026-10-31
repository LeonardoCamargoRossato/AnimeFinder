import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import SynopsisEnhancer from './SynopsisEnhancer'
import WishlistEnhancer from './WishlistEnhancer'
import { handleSupabaseAuthCallback } from './authCallback'
import './styles.css'
import './auth.css'
import './synopsis.css'
import './synopsis-rate.css'
import './wishlists.css'

function NavigationLabelEnhancer() {
  useEffect(() => {
    const syncLabel = () => {
      const link = document.querySelector('.main-nav a[href*="/app/my-anime"]')
      if (link && link.textContent !== 'My Watched Anime') link.textContent = 'My Watched Anime'
    }

    syncLabel()
    const observer = new MutationObserver(syncLabel)
    const root = document.getElementById('root')
    if (root) observer.observe(root, { childList: true, subtree: true })

    return () => observer.disconnect()
  }, [])

  return null
}

async function bootstrap() {
  await handleSupabaseAuthCallback()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <HashRouter>
        <NavigationLabelEnhancer />
        <SynopsisEnhancer />
        <WishlistEnhancer />
        <App />
      </HashRouter>
    </StrictMode>,
  )
}

void bootstrap()
