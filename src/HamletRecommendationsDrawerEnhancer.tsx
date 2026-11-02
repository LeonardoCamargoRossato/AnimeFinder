import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type DrawerMode = 'closed' | 'normal' | 'fullscreen'

const ACTION_HOST = 'data-hamlet-recommendations-action-host'
const CONTROLS_HOST = 'data-hamlet-recommendations-controls-host'

export default function HamletRecommendationsDrawerEnhancer() {
  const [panel, setPanel] = useState<HTMLElement | null>(null)
  const [actionHost, setActionHost] = useState<HTMLElement | null>(null)
  const [controlsHost, setControlsHost] = useState<HTMLElement | null>(null)
  const [recommendationCount, setRecommendationCount] = useState(0)
  const [mode, setMode] = useState<DrawerMode>('closed')

  useEffect(() => {
    const root = document.getElementById('root')
    if (!root) return

    const sync = () => {
      const workspace = document.querySelector('.hamlet-workspace') as HTMLElement | null
      const nextPanel = workspace?.querySelector('.hamlet-recommendations-panel') as HTMLElement | null
      const conversationHeading = workspace?.querySelector('.hamlet-conversation-panel .hamlet-panel-heading') as HTMLElement | null
      const recommendationsHeading = nextPanel?.querySelector('.hamlet-panel-heading') as HTMLElement | null

      if (!workspace || !nextPanel || !conversationHeading || !recommendationsHeading) {
        setPanel(null)
        setActionHost(null)
        setControlsHost(null)
        setRecommendationCount(0)
        return
      }

      workspace.classList.add('hamlet-drawer-experience')
      nextPanel.classList.add('hamlet-recommendations-drawer')

      let nextActionHost = conversationHeading.querySelector(`[${ACTION_HOST}]`) as HTMLElement | null
      if (!nextActionHost) {
        nextActionHost = document.createElement('div')
        nextActionHost.setAttribute(ACTION_HOST, 'true')
        nextActionHost.className = 'hamlet-recommendations-action-host'
        conversationHeading.appendChild(nextActionHost)
      }

      let nextControlsHost = recommendationsHeading.querySelector(`[${CONTROLS_HOST}]`) as HTMLElement | null
      if (!nextControlsHost) {
        nextControlsHost = document.createElement('div')
        nextControlsHost.setAttribute(CONTROLS_HOST, 'true')
        nextControlsHost.className = 'hamlet-recommendations-controls-host'
        recommendationsHeading.appendChild(nextControlsHost)
      }

      setPanel((current) => current === nextPanel ? current : nextPanel)
      setActionHost((current) => current === nextActionHost ? current : nextActionHost)
      setControlsHost((current) => current === nextControlsHost ? current : nextControlsHost)
      setRecommendationCount(nextPanel.querySelectorAll('.hamlet-compact-card').length)
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      document.querySelector('.hamlet-workspace')?.classList.remove('hamlet-drawer-experience')
      document.querySelector('.hamlet-recommendations-panel')?.classList.remove(
        'hamlet-recommendations-drawer',
        'drawer-open',
        'drawer-fullscreen',
      )
      document.body.classList.remove('hamlet-recommendations-drawer-open')
    }
  }, [])

  useEffect(() => {
    if (!panel) return
    panel.classList.toggle('drawer-open', mode !== 'closed')
    panel.classList.toggle('drawer-fullscreen', mode === 'fullscreen')
    document.body.classList.toggle('hamlet-recommendations-drawer-open', mode !== 'closed')
  }, [panel, mode])

  useEffect(() => {
    if (recommendationCount === 0 && mode !== 'closed') setMode('closed')
  }, [recommendationCount, mode])

  if (!panel) return null

  return <>
    {actionHost && recommendationCount > 0 && createPortal(
      <button
        className="primary-button hamlet-view-recommendations"
        type="button"
        onClick={() => setMode('normal')}
        aria-haspopup="dialog"
      >
        Ver recomendações <span>{recommendationCount}</span>
      </button>,
      actionHost,
    )}

    {controlsHost && createPortal(
      <div className="hamlet-drawer-controls" aria-label="Recommendation panel controls">
        {mode === 'fullscreen' ? (
          <button type="button" onClick={() => setMode('normal')} title="Voltar ao tamanho normal" aria-label="Voltar ao tamanho normal">↙</button>
        ) : (
          <button type="button" onClick={() => setMode('fullscreen')} title="Expandir para tela inteira" aria-label="Expandir para tela inteira">⛶</button>
        )}
        <button type="button" onClick={() => setMode('closed')} title="Recolher recomendações" aria-label="Recolher recomendações">›</button>
      </div>,
      controlsHost,
    )}

    {recommendationCount > 0 && mode === 'closed' && createPortal(
      <button
        className="hamlet-drawer-reopen-tab"
        type="button"
        onClick={() => setMode('normal')}
        aria-label="Reabrir recomendações"
        title="Ver recomendações"
      >
        ‹
      </button>,
      document.body,
    )}

    {mode !== 'closed' && createPortal(
      <button
        className="hamlet-drawer-mobile-backdrop"
        type="button"
        onClick={() => setMode('closed')}
        aria-label="Fechar painel de recomendações"
      />,
      document.body,
    )}
  </>
}
