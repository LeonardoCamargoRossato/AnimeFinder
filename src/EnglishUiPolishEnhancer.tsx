import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const translations = new Map([
  ['Ver em português', 'View in Portuguese'],
  ['Ver original', 'View original'],
  ['🔊 Escutar', '🔊 Listen'],
])

export default function EnglishUiPolishEnhancer() {
  const location = useLocation()
  useEffect(() => {
    const sync = () => {
      document.querySelectorAll('button').forEach((button) => {
        const current = button.textContent?.trim() ?? ''
        const next = translations.get(current)
        if (next && current !== next) button.textContent = next
      })
    }
    sync()
    const observer = new MutationObserver(sync)
    const root = document.getElementById('root')
    if (root) observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [location.pathname, location.search])
  return null
}
