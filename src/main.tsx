import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import SynopsisEnhancer from './SynopsisEnhancer'
import { handleSupabaseAuthCallback } from './authCallback'
import './styles.css'
import './auth.css'
import './synopsis.css'
import './synopsis-rate.css'

async function bootstrap() {
  await handleSupabaseAuthCallback()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <HashRouter>
        <SynopsisEnhancer />
        <App />
      </HashRouter>
    </StrictMode>,
  )
}

void bootstrap()
