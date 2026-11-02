import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import HamletAIWorkspace from './HamletAIWorkspace'
import HamletModeSelector, { type HamletMode } from './HamletModeSelector'
import HamletSelfKnowledgeWorkspace from './HamletSelfKnowledgeWorkspace'
import './hamlet-viewport-hotfix.css'
import './hamlet-chat-bubbles-hotfix.css'
import './hamlet-dual-mode.css'

type DiscoverMode = 'search' | 'hamlet'
type HamletContext = 'discover' | 'watched' | 'lists' | null

export default function HamletAIEnhancer() {
  const location = useLocation()
  const context = useMemo<HamletContext>(() => {
    if (location.pathname === '/app') {
      return new URLSearchParams(location.search).get('view') === 'my-lists' ? 'lists' : 'discover'
    }
    if (location.pathname === '/app/my-anime') return 'watched'
    return null
  }, [location.pathname, location.search])

  const [discoverMode, setDiscoverMode] = useState<DiscoverMode>('search')
  const [hamletMode, setHamletMode] = useState<HamletMode>('discovery')
  const [contextPanelOpen, setContextPanelOpen] = useState(false)
  const [tabHost, setTabHost] = useState<HTMLElement | null>(null)
  const [launcherHost, setLauncherHost] = useState<HTMLElement | null>(null)
  const [workspaceHost, setWorkspaceHost] = useState<HTMLElement | null>(null)
  const [selectorHost, setSelectorHost] = useState<HTMLElement | null>(null)

  const workspaceVisible = context === 'discover' ? discoverMode === 'hamlet' : Boolean(context && contextPanelOpen)

  useEffect(() => {
    setSelectorHost(null)
    setWorkspaceHost(null)
    setLauncherHost(null)
    setTabHost(null)
    setContextPanelOpen(false)
    if (context === 'discover') {
      setDiscoverMode('search')
      setHamletMode('discovery')
    } else if (context === 'watched' || context === 'lists') {
      setDiscoverMode('hamlet')
      setHamletMode('self-knowledge')
    }
  }, [context])

  useEffect(() => {
    if (!context) return

    const sync = () => {
      document.querySelectorAll('.hamlet-context-page').forEach((node) => {
        if (!(node instanceof HTMLElement)) return
        if (context === 'watched' && node.matches('.page.narrow-page')) return
        if (context === 'lists' && node.matches('.my-lists-page')) return
        node.classList.remove('hamlet-context-page')
      })

      if (context === 'discover') {
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

        page.classList.toggle('hamlet-mode-active', discoverMode === 'hamlet')
        page.classList.toggle('hamlet-self-knowledge-active', discoverMode === 'hamlet' && hamletMode === 'self-knowledge')
        setTabHost((current) => current === tabs ? current : tabs)
        setLauncherHost(null)
        setWorkspaceHost((current) => current === workspace ? current : workspace)
        return
      }

      document.querySelector('.discover-page')?.classList.remove('hamlet-mode-active', 'hamlet-self-knowledge-active')
      const pageSelector = context === 'watched' ? '.page.narrow-page' : '.my-lists-page'
      const page = document.querySelector(pageSelector) as HTMLElement | null
      if (!page) return
      page.classList.add('hamlet-context-page')

      let launcher = page.querySelector('[data-hamlet-context-launcher-host]') as HTMLElement | null
      if (!launcher) {
        launcher = document.createElement('div')
        launcher.dataset.hamletContextLauncherHost = 'true'
        launcher.className = 'hamlet-context-launcher-host'
        const intro = page.querySelector('.page-intro')
        if (intro?.nextSibling) page.insertBefore(launcher, intro.nextSibling)
        else page.insertBefore(launcher, page.firstChild)
      }

      let workspace = page.querySelector('[data-hamlet-context-workspace-host]') as HTMLElement | null
      if (!workspace) {
        workspace = document.createElement('div')
        workspace.dataset.hamletContextWorkspaceHost = 'true'
        workspace.className = 'hamlet-context-workspace-host'
        launcher.insertAdjacentElement('afterend', workspace)
      }

      setTabHost(null)
      setLauncherHost((current) => current === launcher ? current : launcher)
      setWorkspaceHost((current) => current === workspace ? current : workspace)
    }

    sync()
    const root = document.getElementById('root')
    const observer = new MutationObserver(sync)
    if (root) observer.observe(root, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      document.querySelector('.discover-page')?.classList.remove('hamlet-mode-active', 'hamlet-self-knowledge-active')
      document.querySelectorAll('.hamlet-context-page').forEach((node) => node.classList.remove('hamlet-context-page'))
    }
  }, [context, discoverMode, hamletMode])

  useEffect(() => {
    setSelectorHost(null)
    if (!workspaceVisible || !workspaceHost) return

    const syncSelector = () => {
      const existing = workspaceHost.querySelector('[data-hamlet-mode-selector-host]') as HTMLElement | null
      if (existing) {
        setSelectorHost((current) => current === existing ? current : existing)
        return
      }

      const headerCopy = workspaceHost.querySelector('.hamlet-workspace .hamlet-header > div:first-child') as HTMLElement | null
      if (!headerCopy) return
      const host = document.createElement('div')
      host.dataset.hamletModeSelectorHost = 'true'
      host.className = 'hamlet-dual-mode-selector-host'
      const eyebrow = headerCopy.querySelector('.eyebrow')
      eyebrow?.insertAdjacentElement('afterend', host)
      if (!eyebrow) headerCopy.prepend(host)
      setSelectorHost(host)
    }

    syncSelector()
    const observer = new MutationObserver(syncSelector)
    observer.observe(workspaceHost, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [workspaceHost, workspaceVisible, hamletMode])

  useEffect(() => {
    if (!workspaceVisible || !workspaceHost) return
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
  }, [workspaceVisible, workspaceHost, hamletMode])

  if (!context) return null

  return <>
    {context === 'discover' && tabHost && createPortal(
      <div className="hamlet-mode-tabs" role="tablist" aria-label="Anime discovery mode">
        <button role="tab" aria-selected={discoverMode === 'search'} className={discoverMode === 'search' ? 'active' : ''} onClick={() => setDiscoverMode('search')}>Search</button>
        <button role="tab" aria-selected={discoverMode === 'hamlet'} className={discoverMode === 'hamlet' ? 'active' : ''} onClick={() => setDiscoverMode('hamlet')}>✨ Hamlet AI</button>
      </div>,
      tabHost,
    )}

    {launcherHost && createPortal(
      <button
        type="button"
        className={`hamlet-context-launcher ${contextPanelOpen ? 'active' : ''}`}
        onClick={() => setContextPanelOpen((value) => !value)}
        aria-expanded={contextPanelOpen}
      >
        {contextPanelOpen ? '✕ Close Hamlet AI' : '✨ Open Hamlet AI'}
      </button>,
      launcherHost,
    )}

    {selectorHost && workspaceVisible && createPortal(
      <HamletModeSelector mode={hamletMode} onChange={setHamletMode} />,
      selectorHost,
    )}

    {workspaceHost && workspaceVisible && createPortal(
      hamletMode === 'discovery' ? <HamletAIWorkspace /> : <HamletSelfKnowledgeWorkspace />,
      workspaceHost,
    )}
  </>
}
