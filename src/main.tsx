import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import NavigationEnhancer from './NavigationEnhancer'
import PersonalCatalogManagerV2Enhancer from './PersonalCatalogManagerV2Enhancer'
import PersonalWorkAssociationEnhancer from './PersonalWorkAssociationEnhancer'
import PersonalKnowledgeDetailsEnhancer from './PersonalKnowledgeDetailsEnhancer'
import CharacterKnowledgeEnhancer from './CharacterKnowledgeEnhancer'
import CharacterProfileProviderEnhancer from './CharacterProfileProviderEnhancer'
import FandomPersistenceEnhancer from './FandomPersistenceEnhancer'
import MasterDataTableEnhancer from './MasterDataTableEnhancer'
import AIEnrichmentEnhancer from './AIEnrichmentEnhancer'
import PersonalKnowledgeChatBubbleEnhancer from './PersonalKnowledgeChatBubbleEnhancer'
import HamletAIEnhancer from './HamletAIEnhancer'
import HamletRecommendationsDrawerEnhancer from './HamletRecommendationsDrawerEnhancer'
import HamletVoiceInputEnhancer from './HamletVoiceInputEnhancer'
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
import './hamlet-ai.css'
import './hamlet-chat-bubbles-global.css'
import './hamlet-recommendations-drawer.css'
import './hamlet-recommendation-card-watch-hotfix.css'
import './hamlet-voice-input.css'
import './character-knowledge.css'
import './character-linking-fix.css'
import './character-knowledge-v2.css'
import './personal-knowledge-v3.css'
import './master-data-table.css'
import './master-data-single-source.css'
import './single-source-v1.css'
import './analytics.css'
import './personal-knowledge-layout-hotfix.css'
import './personal-knowledge-chat-bubbles.css'

async function bootstrap() {
  await handleSupabaseAuthCallback()
  try { await migrateLegacyBrowserPersistence() }
  catch (error) { console.error('AnimeFinder legacy migration bootstrap failed.', error) }
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
        <CharacterProfileProviderEnhancer />
        <FandomPersistenceEnhancer />
        <MasterDataTableEnhancer />
        <AIEnrichmentEnhancer />
        <PersonalKnowledgeChatBubbleEnhancer />
        <HamletAIEnhancer />
        <HamletRecommendationsDrawerEnhancer />
        <HamletVoiceInputEnhancer />
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