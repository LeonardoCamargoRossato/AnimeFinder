import { useEffect } from 'react'

const LONG_MESSAGE_THRESHOLD = 320
const ENHANCED_ATTR = 'data-pk-chat-bubble-enhanced'

function setExpanded(target: HTMLElement, expanded: boolean) {
  target.classList.toggle('pk-bubble-expanded', expanded)
  const toggle = target.querySelector(':scope > .pk-bubble-toggle') as HTMLButtonElement | null
  if (toggle) {
    toggle.textContent = expanded ? 'Show less' : 'See more'
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false')
  }
}

function enhanceBubble(target: HTMLElement) {
  if (target.hasAttribute(ENHANCED_ATTR)) return

  const paragraph = target.querySelector(':scope > p') as HTMLParagraphElement | null
  if (!paragraph) return

  target.setAttribute(ENHANCED_ATTR, 'true')
  const text = paragraph.textContent?.trim() ?? ''
  if (text.length <= LONG_MESSAGE_THRESHOLD) return

  target.classList.add('pk-collapsible-bubble')

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'pk-bubble-toggle'
  toggle.textContent = 'See more'
  toggle.setAttribute('aria-expanded', 'false')
  toggle.setAttribute('aria-label', 'Expand message')

  toggle.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const expanded = !target.classList.contains('pk-bubble-expanded')
    setExpanded(target, expanded)
  })

  target.addEventListener('click', (event) => {
    const clicked = event.target as HTMLElement
    if (clicked.closest('button, textarea, input, select, a')) return
    event.preventDefault()
    event.stopPropagation()
    const expanded = !target.classList.contains('pk-bubble-expanded')
    setExpanded(target, expanded)
  })

  target.appendChild(toggle)
}

function enhancePersonalKnowledgeConversation() {
  document.querySelectorAll<HTMLElement>('.pk-chat .pk-message.assistant > div').forEach(enhanceBubble)
  document.querySelectorAll<HTMLElement>('.pk-chat .pk-message.user > .pk-user-bubble').forEach(enhanceBubble)

  document.querySelectorAll<HTMLElement>('.pk-chat .pk-context-actions').forEach((actions) => {
    actions.classList.add('pk-hamlet-action-bubble')
  })
}

export default function PersonalKnowledgeChatBubbleEnhancer() {
  useEffect(() => {
    const root = document.getElementById('root')
    if (!root) return

    let frame = 0
    const schedule = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(enhancePersonalKnowledgeConversation)
    }

    enhancePersonalKnowledgeConversation()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })

    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
    }
  }, [])

  return null
}
