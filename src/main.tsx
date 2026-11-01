import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import NavigationEnhancer from './NavigationEnhancer'
import PersonalCatalogManagerEnhancer from './PersonalCatalogManagerEnhancer'
import PersonalWorkAssociationEnhancer from './PersonalWorkAssociationEnhancer'
import AIEnrichmentEnhancer from './AIEnrichmentEnhancer'
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
import './personal-catalog-manager.css'
import './ai-enrichment.css'
import './ai-personal-knowledge.css'
import './analytics.css'

async function bootstrap() {
  await handleSupabaseAuthCallback()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <HashRouter>
        <NavigationEnhancer />
        <PersonalCatalogManagerEnhancer />
        <PersonalWorkAssociationEnhancer />
        <AIEnrichmentEnhancer />
        <WishlistEnhancer />
        <App />
      </HashRouter>
    </StrictMode>,
  )
}

void bootstrap()
