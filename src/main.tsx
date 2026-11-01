import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import AnimeDetailsV2Enhancer from './AnimeDetailsV2Enhancer'
import NavigationEnhancer from './NavigationEnhancer'
import NerdDataProgressiveEnhancer from './NerdDataProgressiveEnhancer'
import PersonalCatalogEnhancer from './PersonalCatalogEnhancer'
import SynopsisEnhancer from './SynopsisEnhancer'
import WatchedStateEnhancer from './WatchedStateEnhancer'
import WishlistEnhancer from './WishlistEnhancer'
import { handleSupabaseAuthCallback } from './authCallback'
import './styles.css'
import './auth.css'
import './synopsis.css'
import './synopsis-rate.css'
import './wishlists.css'
import './navigation.css'
import './personal-catalog.css'
import './personal-catalog-comments.css'

async function bootstrap() {
  await handleSupabaseAuthCallback()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <HashRouter>
        <NavigationEnhancer />
        <PersonalCatalogEnhancer />
        <SynopsisEnhancer />
        <AnimeDetailsV2Enhancer />
        <NerdDataProgressiveEnhancer />
        <WatchedStateEnhancer />
        <WishlistEnhancer />
        <App />
      </HashRouter>
    </StrictMode>,
  )
}

void bootstrap()
