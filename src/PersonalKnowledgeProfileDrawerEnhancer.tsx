import { useEffect } from 'react'

type SectionState = 'collapsed' | 'preview' | 'full'

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
    expandButton.title = 'Expand section fully'
    expandButton.setAttribute('aria-label', 'Expand section fully')
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
    const state = (card.dataset.pkSectionState || 'collapsed') as SectionState
    setSectionState(card, state === 'collapsed' ? 'preview' : 'full')
  })

  close.addEventListener('click', (event) => {
    event.stopPropagation()
    setSectionState(card, 'collapsed')
  })

  actions.append(expand, close)
  title.append(actions)

  title.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('button')) return
    const state = (card.dataset.pkSectionState || 'collapsed') as SectionState
    if (state === 'collapsed') setSectionState(card, 'preview')
  })

  setSectionState(card, 'collapsed')
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
  useEffect(() => {
    const scan = () => {
      document.querySelectorAll<HTMLElement>('.pk-workspace').forEach(enhanceWorkspace)
    }

    scan()
    const observer = new MutationObserver(scan)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  return null
}
