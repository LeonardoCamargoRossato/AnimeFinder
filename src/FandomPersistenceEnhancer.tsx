import { useEffect } from 'react'

export default function FandomPersistenceEnhancer() {
  useEffect(() => {
    const onConfirmed = (event: Event) => {
      const detail = (event as CustomEvent<{ canonicalName?: string; storage?: 'supabase' | 'local'; verified?: boolean }>).detail
      if (detail?.storage !== 'supabase' || !detail.verified) return

      const modal = document.querySelector('.character-link-modal') as HTMLElement | null
      const close = modal?.querySelector('.character-profile-close') as HTMLButtonElement | null
      close?.click()

      const toast = document.createElement('div')
      toast.className = 'animefinder-fandom-toast'
      toast.textContent = `Fandom match verified in Supabase: ${detail.canonicalName ?? 'character'}`
      document.body.appendChild(toast)
      window.setTimeout(() => toast.remove(), 4200)
    }
    window.addEventListener('animefinder:fandom-match-confirmed', onConfirmed)
    return () => window.removeEventListener('animefinder:fandom-match-confirmed', onConfirmed)
  }, [])
  return null
}
