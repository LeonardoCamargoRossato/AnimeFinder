import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import SynopsisAudioPlayer from './SynopsisAudioPlayer'

type SectionState = 'collapsed' | 'preview' | 'full'

type FullscreenCommentDetail = {
  text: string
  version: string
}

function openCommentFullscreen(card: HTMLElement, title: HTMLElement) {
  const directText = card.querySelector<HTMLElement>(':scope > p')?.innerText.trim() ?? ''
  const fallbackText = Array.from(card.querySelectorAll<HTMLElement>('p'))
    .map((node) => node.innerText.trim())
    .find(Boolean) ?? ''
  const text = directText || fallbackText
  if (!text) return

  const version = title.querySelector<HTMLElement>(':scope > small')?.innerText.trim() ?? ''
  window.dispatchEvent(new CustomEvent<FullscreenCommentDetail>('animefinder:open-current-comment-fullscreen', {
    detail: { text, version },
  }))
}

function setSectionState(card: HTMLElement, state: SectionState) {
  card.classList.remove('pk-section-collapsed', 'pk-section-preview', 'pk-section-full')
  card.classList.add(`pk-section-${state}`)
  card.dataset.pkSectionState = state

  const expandButton = card.querySelector<HTMLButtonElement>('.pk-section-expand')
  const closeButton = card.querySelector<HTMLButtonElement>('.pk-section-close')
  if (!expandButton || !closeButton) return

  if (state === 'collapsed') {
    expandButton.textContent = '＋'
    expandButton.title = 'Expand section'
    expandButton.setAttribute('aria-label', 'Expand section')
    expandButton.hidden = false
    closeButton.hidden = true
  } else if (state === 'preview') {
    expandButton.textContent = '⛶'
    expandButton.title = card.classList.contains('pk-section-comment') ? 'Open Current Comment fullscreen' : 'Expand section fully'
    expandButton.setAttribute('aria-label', expandButton.title)
    expandButton.hidden = false
    closeButton.hidden = false
  } else {
    expandButton.hidden = true
    closeButton.hidden = false
  }
}

function enhanceSection(card: HTMLElement) {
  if (card.dataset.pkSectionEnhanced === 'true') return
  const title = card.querySelector<HTMLElement>('.ai-profile-card-title')
  if (!title) return

  card.dataset.pkSectionEnhanced = 'true'
  card.classList.add('pk-collapsible-section')

  const titleText = title.textContent?.toLowerCase() ?? ''
  if (titleText.includes('comment')) card.classList.add('pk-section-comment')
  else if (titleText.includes('keyword') || titleText.includes('personal signals')) card.classList.add('pk-section-keywords')
  else if (titleText.includes('character')) card.classList.add('pk-section-characters')

  const actions = document.createElement('div')
  actions.className = 'pk-section-controls'

  const expand = document.createElement('button')
  expand.type = 'button'
  expand.className = 'pk-section-expand'

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'pk-section-close'
  close.textContent = '×'
  close.title = 'Return to compact view'
  close.setAttribute('aria-label', 'Return to compact view')

  expand.addEventListener('click', (event) => {
    event.stopPropagation()
    const state = (card.dataset.pkSectionState || 'preview') as SectionState
    if (state === 'collapsed') {
      setSectionState(card, 'preview')
      return
    }
    if (card.classList.contains('pk-section-comment')) {
      openCommentFullscreen(card, title)
      return
    }
    setSectionState(card, 'full')
  })

  close.addEventListener('click', (event) => {
    event.stopPropagation()
    setSectionState(card, 'collapsed')
  })

  actions.append(expand, close)
  title.append(actions)

  title.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('button')) return
    const state = (card.dataset.pkSectionState || 'preview') as SectionState
    if (state === 'collapsed') setSectionState(card, 'preview')
  })

  setSectionState(card, 'preview')
}

function enhanceWorkspace(workspace: HTMLElement) {
  const body = workspace.querySelector<HTMLElement>('.pk-body')
  const profile = workspace.querySelector<HTMLElement>('.pk-profile')
  if (!body || !profile) return

  profile.querySelectorAll<HTMLElement>(':scope > .ai-profile-card').forEach(enhanceSection)

  if (workspace.querySelector('.pk-profile-drawer-toggle')) return

  workspace.classList.add('pk-profile-drawer-ready')
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'pk-profile-drawer-toggle'
  toggle.textContent = '›'
  toggle.title = 'Collapse profile panel'
  toggle.setAttribute('aria-label', 'Collapse profile panel')

  toggle.addEventListener('click', () => {
    const collapsed = body.classList.toggle('pk-profile-drawer-collapsed')
    toggle.textContent = collapsed ? '‹' : '›'
    toggle.title = collapsed ? 'Open profile panel' : 'Collapse profile panel'
    toggle.setAttribute('aria-label', collapsed ? 'Open profile panel' : 'Collapse profile panel')
  })

  workspace.append(toggle)
}

export default function PersonalKnowledgeProfileDrawerEnhancer() {
  const [fullscreenComment, setFullscreenComment] = useState<FullscreenCommentDetail | null>(null)
  const [audioOpen, setAudioOpen] = useState(false)

  useEffect(() => {
    const scan = () => {
      document.querySelectorAll<HTMLElement>('.pk-workspace').forEach(enhanceWorkspace)
    }
    const openFullscreen = (event: Event) => {
      const detail = (event as CustomEvent<FullscreenCommentDetail>).detail
      if (!detail?.text) return
      setAudioOpen(false)
      setFullscreenComment(detail)
    }

    scan()
    const observer = new MutationObserver(scan)
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('animefinder:open-current-comment-fullscreen', openFullscreen)
    return () => {
      observer.disconnect()
      window.removeEventListener('animefinder:open-current-comment-fullscreen', openFullscreen)
    }
  }, [])

  useEffect(() => {
    if (!fullscreenComment) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setAudioOpen(false)
      setFullscreenComment(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fullscreenComment])

  if (!fullscreenComment) return null

  const closeFullscreen = () => {
    setAudioOpen(false)
    setFullscreenComment(null)
  }

  return createPortal(
    <div className="pk-comment-fullscreen-backdrop" role="dialog" aria-modal="true" aria-label="Current comment fullscreen">
      <section className="pk-comment-fullscreen">
        <header className="pk-comment-fullscreen-header">
          <div className="pk-comment-fullscreen-heading">
            <span>COMMENT</span>
            <h2>Current comment</h2>
            {fullscreenComment.version && <small>{fullscreenComment.version}</small>}
          </div>
          <div className="pk-comment-fullscreen-actions">
            <button type="button" className="ghost-button" onClick={() => setAudioOpen(true)}>🔊 Listen</button>
            <button type="button" className="pk-comment-fullscreen-close" onClick={closeFullscreen} aria-label="Close Current Comment fullscreen">×</button>
          </div>
        </header>
        <div className="pk-comment-fullscreen-content">
          <p>{fullscreenComment.text}</p>
        </div>
        {audioOpen && (
          <div className="pk-comment-fullscreen-audio">
            <SynopsisAudioPlayer
              text={fullscreenComment.text}
              lang="pt-BR"
              languageLabel="Português (Brasil)"
              onClose={() => setAudioOpen(false)}
            />
          </div>
        )}
      </section>
    </div>,
    document.body,
  )
}
