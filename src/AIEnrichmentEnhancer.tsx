import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import AIEnrichmentWorkspace from './AIEnrichmentWorkspace'
import { findManagedWorkByMalId, listManagedCatalogWorks, type ManagedCatalogWork } from './personalCatalogManager'
import { hasLocalKnowledge } from './aiPersonalKnowledge'

interface OpenKnowledgeDetail {
  workId?: string
  malId?: number | null
  work?: ManagedCatalogWork
}

export default function AIEnrichmentEnhancer() {
  const location = useLocation()
  const [selected, setSelected] = useState<ManagedCatalogWork | null>(null)
  const [, forceRefresh] = useState(0)

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<OpenKnowledgeDetail>).detail ?? {}
      const work = detail.work
        ?? (detail.workId ? listManagedCatalogWorks().find((item) => item.id === detail.workId) ?? null : null)
        ?? (detail.malId != null ? findManagedWorkByMalId(Number(detail.malId)) : null)
      if (work) setSelected(work)
    }
    window.addEventListener('animefinder:open-personal-knowledge', handler)
    return () => window.removeEventListener('animefinder:open-personal-knowledge', handler)
  }, [])

  useEffect(() => {
    let cleanupFns: Array<() => void> = []
    let frame = 0

    function clear() {
      cleanupFns.forEach((fn) => fn())
      cleanupFns = []
      document.querySelectorAll('.ai-enrich-details-injected').forEach((node) => node.remove())
    }

    function injectDetailsButton() {
      const match = location.pathname.match(/^\/app\/anime\/(\d+)$/)
      if (!match || new URLSearchParams(location.search).get('view') === 'analysis') return
      const work = findManagedWorkByMalId(Number(match[1]))
      if (!work) return
      const actions = document.querySelector('.details-v2-actions') as HTMLElement | null
      if (!actions || actions.querySelector('.ai-enrich-details-injected')) return
      const enriched = hasLocalKnowledge(work.id)
      const button = document.createElement('button')
      button.type = 'button'
      button.className = enriched ? 'ghost-button ai-enrich-entry ai-enrich-details-injected enriched' : 'ghost-button ai-enrich-entry ai-enrich-details-injected'
      button.setAttribute('aria-label', 'Enrich with Hamlet AI')
      button.title = enriched ? 'Open Hamlet AI personal knowledge' : 'Enrich this anime with Hamlet AI'
      button.style.display = 'inline-flex'
      button.style.alignItems = 'center'
      button.style.gap = '8px'
      button.style.minHeight = '40px'
      button.style.padding = '7px 13px 7px 10px'
      button.style.border = '1px solid color-mix(in srgb, var(--accent) 82%, #fff 18%)'
      button.style.background = 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 22%, var(--surface)), color-mix(in srgb, var(--accent) 10%, var(--background)))'
      button.style.color = 'color-mix(in srgb, var(--accent) 82%, #fff 18%)'
      button.style.boxShadow = '0 0 0 1px color-mix(in srgb, var(--accent) 24%, transparent), 0 0 18px color-mix(in srgb, var(--accent) 30%, transparent)'

      const sparkle = document.createElement('span')
      sparkle.setAttribute('aria-hidden', 'true')
      sparkle.textContent = '✨'
      sparkle.style.display = 'inline-grid'
      sparkle.style.placeItems = 'center'
      sparkle.style.flex = '0 0 auto'
      sparkle.style.fontSize = '16px'
      sparkle.style.lineHeight = '1'
      sparkle.style.filter = 'drop-shadow(0 0 6px color-mix(in srgb, var(--accent) 72%, transparent))'

      const label = document.createElement('span')
      label.textContent = 'Enrich with Hamlet AI'
      label.style.fontWeight = '800'
      label.style.whiteSpace = 'nowrap'

      button.replaceChildren(sparkle, label)

      const enterHandler = () => {
        button.style.transform = 'translateY(-1px)'
        button.style.borderColor = 'color-mix(in srgb, var(--accent) 92%, #fff 8%)'
        button.style.boxShadow = '0 0 0 2px color-mix(in srgb, var(--accent) 22%, transparent), 0 0 24px color-mix(in srgb, var(--accent) 46%, transparent)'
      }
      const leaveHandler = () => {
        button.style.transform = ''
        button.style.borderColor = 'color-mix(in srgb, var(--accent) 82%, #fff 18%)'
        button.style.boxShadow = '0 0 0 1px color-mix(in srgb, var(--accent) 24%, transparent), 0 0 18px color-mix(in srgb, var(--accent) 30%, transparent)'
      }
      const handler = () => setSelected(work)
      button.addEventListener('mouseenter', enterHandler)
      button.addEventListener('mouseleave', leaveHandler)
      button.addEventListener('click', handler)
      cleanupFns.push(() => {
        button.removeEventListener('mouseenter', enterHandler)
        button.removeEventListener('mouseleave', leaveHandler)
        button.removeEventListener('click', handler)
      })
      actions.appendChild(button)
    }

    function sync() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(injectDetailsButton)
    }

    sync()
    const observer = new MutationObserver(sync)
    const root = document.getElementById('root')
    if (root) observer.observe(root, { childList: true, subtree: true })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      clear()
    }
  }, [location.pathname, location.search])

  return selected ? <AIEnrichmentWorkspace work={selected} onClose={() => setSelected(null)} onSaved={() => {
    forceRefresh((value) => value + 1)
    window.dispatchEvent(new CustomEvent('animefinder:personal-knowledge-updated'))
  }} /> : null
}
