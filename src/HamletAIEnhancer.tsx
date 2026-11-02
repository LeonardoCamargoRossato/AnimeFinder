import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import HamletAIWorkspace from './HamletAIWorkspace'
import './hamlet-viewport-hotfix.css'
import './hamlet-chat-bubbles-hotfix.css'

type DiscoverMode = 'search' | 'hamlet'

export default function HamletAIEnhancer() {
  const location = useLocation()
  const [mode, setMode] = useState<DiscoverMode>('search')
  const [tabHost, setTabHost] = useState<HTMLElement | null>(null)
  const [workspaceHost, setWorkspaceHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (location.pathname !== '/app') {
      setMode('search'); setTabHost(null); setWorkspaceHost(null)
      return
    }
    const sync = () => {
      const page = document.querySelector('.discover-page') as HTMLElement | null
      const hero = page?.querySelector('.hero') as HTMLElement | null
      const searchBar = hero?.querySelector('.search-bar') as HTMLElement | null
      if (!page || !hero || !searchBar) return

      let tabs = hero.querySelector('[data-hamlet-mode-tabs]') as HTMLElement | null
      if (!tabs) {
        tabs = document.createElement('div')
        tabs.dataset.hamletModeTabs = 'true'
        tabs.className = 'hamlet-mode-tabs-host'
        hero.insertBefore(tabs, searchBar)
      }
      let workspace = page.querySelector('[data-hamlet-workspace-host]') as HTMLElement | null
      if (!workspace) {
        workspace = document.createElement('div')
        workspace.dataset.hamletWorkspaceHost = 'true'
        workspace.className = 'hamlet-workspace-host'
        hero.insertAdjacentElement('afterend', workspace)
      }
      page.classList.toggle('hamlet-mode-active', mode === 'hamlet')
      setTabHost((current) => current === tabs ? current : tabs)
      setWorkspaceHost((current) => current === workspace ? current : workspace)
    }
    sync()
    const root = document.getElementById('root')
    const observer = new MutationObserver(sync)
    if (root) observer.observe(root, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      document.querySelector('.discover-page')?.classList.remove('hamlet-mode-active')
    }
  }, [location.pathname, mode])

  useEffect(() => {
    if (mode !== 'hamlet' || !workspaceHost) return
    let focusFrame = 0
    const viewportFrame = window.requestAnimationFrame(() => {
      workspaceHost.scrollIntoView({ block: 'start', behavior: 'auto' })
      focusFrame = window.requestAnimationFrame(() => {
        const composer = workspaceHost.querySelector<HTMLTextAreaElement>('.hamlet-composer textarea')
        composer?.focus({ preventScroll: true })
      })
    })
    return () => {
      window.cancelAnimationFrame(viewportFrame)
      if (focusFrame) window.cancelAnimationFrame(focusFrame)
    }
  }, [mode, workspaceHost])

  if (location.pathname !== '/app') return null
  return <>
    {tabHost && createPortal(<div className="hamlet-mode-tabs" role="tablist" aria-label="Anime discovery mode">
      <button role="tab" aria-selected={mode === 'search'} className={mode === 'search' ? 'active' : ''} onClick={() => setMode('search')}>Search</button>
      <button role="tab" aria-selected={mode === 'hamlet'} className={mode === 'hamlet' ? 'active' : ''} onClick={() => setMode('hamlet')}>✨ Hamlet AI</button>
    </div>, tabHost)}
    {workspaceHost && mode === 'hamlet' && createPortal(<HamletAIWorkspace />, workspaceHost)}
  </>
}
