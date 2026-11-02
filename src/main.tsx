import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import NavigationEnhancer from './NavigationEnhancer'
import PersonalCatalogManagerV2Enhancer from './PersonalCatalogManagerV2Enhancer'
import PersonalWorkAssociationEnhancer from './PersonalWorkAssociationEnhancer'
import PersonalKnowledgeDetailsEnhancer from './PersonalKnowledgeDetailsEnhancer'
import CharacterKnowledgeEnhancer from './CharacterKnowledgeEnhancer'
import FandomPersistenceEnhancer from './FandomPersistenceEnhancer'
import MasterDataTableEnhancer from './MasterDataTableEnhancer'
import AIEnrichmentEnhancer from './AIEnrichmentEnhancer'
import WishlistEnhancer from './WishlistEnhancer'
import WishlistWatchedLockEnhancer from './WishlistWatchedLockEnhancer'
import WorldTriggerKeywordHotfixEnhancer from './WorldTriggerKeywordHotfixEnhancer'
import EnglishUiPolishEnhancer from './EnglishUiPolishEnhancer'
import CatalogPdfMenuEnhancer from './CatalogPdfMenuEnhancer'
import { handleSupabaseAuthCallback } from './authCallback'
import { migrateLegacyBrowserPersistence } from './legacyPersistenceMigration'
import { hydrateManagedCatalog } from './personalCatalogManager'
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
import './character-knowledge.css'
import './character-linking-fix.css'
import './character-knowledge-v2.css'
import './personal-knowledge-v3.css'
import './master-data-table.css'
import './analytics.css'

async function bootstrap() {
  await handleSupabaseAuthCallback()

  // One-time bridge only: move historical browser/hardcoded data into Supabase before
  // the runtime starts. Failed migration steps retain their old browser key so data is
  // never destroyed before a verified server write.
  try { await migrateLegacyBrowserPersistence() }
  catch (error) { console.error('AnimeFinder legacy migration bootstrap failed.', error) }

  // Runtime catalog state is reconstructed from Supabase. No localStorage catalog is read.
  try { await hydrateManagedCatalog() }
  catch (error) { console.error('AnimeFinder Supabase catalog hydration failed.', error) }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <HashRouter>
        <NavigationEnhancer />
        <PersonalCatalogManagerV2Enhancer />
        <PersonalWorkAssociationEnhancer />
        <PersonalKnowledgeDetailsEnhancer />
        <CharacterKnowledgeEnhancer />
        <FandomPersistenceEnhancer />
        <MasterDataTableEnhancer />
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
