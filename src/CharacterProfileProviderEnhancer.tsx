import { useEffect } from 'react'

/**
 * Incremental provider-agnostic polish for the existing Character Profile.
 * Personal/external data still comes from the React component/Supabase; this enhancer only
 * prevents the legacy Jikan-empty wording from masking a confirmed Fandom-only source.
 */
export default function CharacterProfileProviderEnhancer() {
  useEffect(() => {
    const sync = () => {
      const modal = document.querySelector('.character-profile-modal') as HTMLElement | null
      if (!modal) return
      const sourceLinks = Array.from(modal.querySelectorAll<HTMLAnchorElement>('.character-external-source-buttons a'))
      const fandomLink = sourceLinks.find((link) => /fandom/i.test(link.textContent ?? ''))
      if (!fandomLink) return

      const empty = modal.querySelector('.character-provider-empty') as HTMLElement | null
      if (empty) {
        const strong = empty.querySelector('strong')
        const paragraph = empty.querySelector('p')
        if (strong && /no jikan/i.test(strong.textContent ?? '')) strong.textContent = 'Fandom character linked.'
        if (paragraph) paragraph.textContent = 'External character information is persisted in Supabase. Jikan is optional.'
        Array.from(empty.querySelectorAll<HTMLButtonElement>('button')).forEach((button) => {
          if (/try fandom/i.test(button.textContent ?? '')) button.style.display = 'none'
          if (/search jikan/i.test(button.textContent ?? '')) button.textContent = 'Add MyAnimeList / Jikan'
        })
      }

      const externalSection = modal.querySelector('.external-section') as HTMLElement | null
      if (externalSection && !externalSection.querySelector('[data-fandom-provider-summary]')) {
        let providerLabel = 'Fandom'
        try {
          const host = new URL(fandomLink.href).hostname.replace(/^www\./, '')
          if (host) providerLabel = `Fandom / ${host}`
        } catch { /* keep Fandom */ }
        const summary = document.createElement('div')
        summary.dataset.fandomProviderSummary = 'true'
        summary.className = 'character-fandom-provider-summary'
        summary.innerHTML = `<span>Provider</span><strong>${providerLabel}</strong><small>Persisted external source · Jikan not required</small>`
        const emptyPanel = externalSection.querySelector('.character-provider-empty')
        if (emptyPanel) emptyPanel.insertAdjacentElement('beforebegin', summary)
        else externalSection.querySelector('.character-profile-section-heading')?.insertAdjacentElement('afterend', summary)
      }
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('animefinder:character-external-sources-updated', sync)
    return () => { observer.disconnect(); window.removeEventListener('animefinder:character-external-sources-updated', sync) }
  }, [])
  return null
}
