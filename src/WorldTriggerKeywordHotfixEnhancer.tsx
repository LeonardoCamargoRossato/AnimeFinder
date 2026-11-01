import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { findManagedWorkByMalId } from './personalCatalogManager'
import { loadPersonalKnowledge, savePersonalKnowledge } from './aiPersonalKnowledge'

const WORLD_TRIGGER_MAL_ID = 44940

const keywordTranslations = new Map<string, string>([
  ['estrategia', 'Strategy'],
  ['combate em equipe', 'Team Combat'],
  ['desenvolvimento de personagem', 'Character Development'],
  ['balanceamento', 'Balance'],
  ['sistema de poder', 'Power System'],
  ['criatividade', 'Creativity'],
  ['personagem inteligente', 'Intelligent Character'],
])

function normalizeLabel(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function translateVisibleKeywords() {
  document.querySelectorAll('.personal-knowledge-ranked-list b, .pk-keyword input').forEach((node) => {
    if (node instanceof HTMLInputElement) {
      const translated = keywordTranslations.get(normalizeLabel(node.value))
      if (translated && node.value !== translated) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(node, translated)
        node.dispatchEvent(new Event('input', { bubbles: true }))
      }
      return
    }

    const text = node.textContent ?? ''
    const match = text.match(/^(#\d+\s+)?(.+)$/)
    const translated = match ? keywordTranslations.get(normalizeLabel(match[2])) : null
    if (translated && match) node.textContent = `${match[1] ?? ''}${translated}`
  })
}

export default function WorldTriggerKeywordHotfixEnhancer() {
  const location = useLocation()

  useEffect(() => {
    const match = location.pathname.match(/^\/app\/anime\/(\d+)$/)
    if (Number(match?.[1]) !== WORLD_TRIGGER_MAL_ID) return

    let live = true
    let frame = 0

    async function migrate() {
      const work = findManagedWorkByMalId(WORLD_TRIGGER_MAL_ID)
      if (!work) return

      try {
        const profile = await loadPersonalKnowledge(work.id, WORLD_TRIGGER_MAL_ID)
        if (!live) return

        let changed = false
        const keywords = profile.keywords.map((keyword) => {
          const translated = keywordTranslations.get(normalizeLabel(keyword.label))
          if (!translated || translated === keyword.label) return keyword
          changed = true
          return { ...keyword, label: translated }
        })

        if (changed) await savePersonalKnowledge({ ...profile, keywords })
        if (!live) return
        translateVisibleKeywords()
      } catch (error) {
        console.warn('AnimeFinder World Trigger keyword hotfix could not persist.', error)
      }
    }

    const sync = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(translateVisibleKeywords)
    }

    void migrate()
    const observer = new MutationObserver(sync)
    const root = document.getElementById('root')
    if (root) observer.observe(root, { childList: true, subtree: true })

    return () => {
      live = false
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [location.pathname])

  return null
}
