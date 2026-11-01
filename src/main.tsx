import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import NavigationEnhancer from './NavigationEnhancer'
import PersonalCatalogManagerV2Enhancer from './PersonalCatalogManagerV2Enhancer'
import PersonalWorkAssociationEnhancer from './PersonalWorkAssociationEnhancer'
import PersonalKnowledgeDetailsEnhancer from './PersonalKnowledgeDetailsEnhancer'
import AIEnrichmentEnhancer from './AIEnrichmentEnhancer'
import WishlistEnhancer from './WishlistEnhancer'
import WishlistWatchedLockEnhancer from './WishlistWatchedLockEnhancer'
import WorldTriggerKeywordHotfixEnhancer from './WorldTriggerKeywordHotfixEnhancer'
import EnglishUiPolishEnhancer from './EnglishUiPolishEnhancer'
import CatalogPdfMenuEnhancer from './CatalogPdfMenuEnhancer'
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
import './personal-catalog-v2.css'
import './ai-enrichment.css'
import './ai-personal-knowledge.css'
import './analytics.css'

async function bootstrap() {
  await handleSupabaseAuthCallback()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <HashRouter>
        <NavigationEnhancer />
        <PersonalCatalogManagerV2Enhancer />
        <PersonalWorkAssociationEnhancer />
        <PersonalKnowledgeDetailsEnhancer />
        <AIEnrichmentEnhancer />
        <WishlistEnhancer />
        <WishlistWatchedLockEnhancer />
        <WorldTriggerKeywordHotfixEnhancer />
        <EnglishUiPolishEnhancer />
        <CatalogPdfMenuEnhancer />
        <App />
      </HashRouter>
    </StrictMode>,
  )
}

void bootstrap()
