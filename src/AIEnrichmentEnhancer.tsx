import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import AIEnrichmentWorkspace from './AIEnrichmentWorkspace'
import { findManagedWorkByMalId, listManagedCatalogWorks, type ManagedCatalogWork } from './personalCatalogManager'
import { hasLocalEnrichment } from './aiEnrichment'
import type { AnimeComment } from './comments'

function findWorkFromRow(row: HTMLTableRowElement): ManagedCatalogWork | null {
  const malLink = row.querySelector('a[href*="myanimelist.net/anime/"]') as HTMLAnchorElement | null
  const malId = malLink?.href.match(/\/anime\/(\d+)/)?.[1]
  if (malId) {
    const found = findManagedWorkByMalId(Number(malId))
    if (found) return found
  }
  const title = row.querySelector('.catalog-anime-cell strong')?.textContent?.trim()
  if (!title) return null
  return listManagedCatalogWorks().find((work) => work.displayName === title) ?? null
}

export default function AIEnrichmentEnhancer() {
  const location = useLocation()
  const [selected, setSelected] = useState<ManagedCatalogWork | null>(null)
  const [, forceRefresh] = useState(0)

  useEffect(() => {
    let cleanupFns: Array<() => void> = []
    let frame = 0

    function clear() {
      cleanupFns.forEach((fn) => fn())
      cleanupFns = []
      document.querySelectorAll('.ai-enrich-injected').forEach((node) => node.remove())
    }

    function injectCatalogButtons() {
      const table = document.querySelector('.catalog-manager-table') as HTMLTableElement | null
      if (!table) return
      const headerRow = table.querySelector('thead tr')
      if (headerRow && !headerRow.querySelector('.ai-enrich-column')) {
        const th = document.createElement('th')
        th.className = 'ai-enrich-column ai-enrich-injected'
        th.textContent = 'AI Profile'
        headerRow.appendChild(th)
      }
      table.querySelectorAll('tbody tr').forEach((element) => {
        const row = element as HTMLTableRowElement
        if (row.querySelector('.ai-enrich-cell')) return
        const work = findWorkFromRow(row)
        if (!work) return
        const cell = document.createElement('td')
        cell.className = 'ai-enrich-cell ai-enrich-injected'
        const button = document.createElement('button')
        button.type = 'button'
        button.className = hasLocalEnrichment(work.id) ? 'ai-enrich-entry enriched' : 'ai-enrich-entry'
        button.textContent = hasLocalEnrichment(work.id) ? '✨ Enriched' : '✨ Enrich with AI'
        button.title = `Enrich ${work.displayName} with AI`
        const handler = () => setSelected(work)
        button.addEventListener('click', handler)
        cleanupFns.push(() => button.removeEventListener('click', handler))
        cell.appendChild(button)
        row.appendChild(cell)
      })
    }

    function injectDetailsButton() {
      const match = location.pathname.match(/^\/app\/anime\/(\d+)$/)
      if (!match || new URLSearchParams(location.search).get('view') === 'analysis') return
      const work = findManagedWorkByMalId(Number(match[1]))
      if (!work) return
      const actions = document.querySelector('.details-v2-actions') as HTMLElement | null
      if (!actions || actions.querySelector('.ai-enrich-entry')) return
      const button = document.createElement('button')
      button.type = 'button'
      button.className = hasLocalEnrichment(work.id) ? 'ghost-button ai-enrich-entry ai-enrich-injected enriched' : 'ghost-button ai-enrich-entry ai-enrich-injected'
      button.textContent = hasLocalEnrichment(work.id) ? '✨ Enriched with AI' : '✨ Enrich with AI'
      const handler = () => setSelected(work)
      button.addEventListener('click', handler)
      cleanupFns.push(() => button.removeEventListener('click', handler))
      actions.appendChild(button)
    }

    function sync() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (location.pathname === '/app/my-anime') injectCatalogButtons()
        injectDetailsButton()
      })
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

  return selected ? <AIEnrichmentWorkspace work={selected} onClose={() => setSelected(null)} onSaved={(_profile, _comment: AnimeComment | null) => forceRefresh((value) => value + 1)} /> : null
}
