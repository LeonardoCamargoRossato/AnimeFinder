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

function resetEditingBubble(target: HTMLElement) {
  if (!target.querySelector(':scope > textarea')) return false
  target.querySelector(':scope > .pk-bubble-toggle')?.remove()
  target.classList.remove('pk-collapsible-bubble', 'pk-bubble-expanded')
  target.removeAttribute(ENHANCED_ATTR)
  return true
}

function enhanceBubble(target: HTMLElement) {
  if (resetEditingBubble(target)) return

  const paragraph = target.querySelector(':scope > p') as HTMLParagraphElement | null
  if (!paragraph) return

  const text = paragraph.textContent?.trim() ?? ''
  const isUserBubble = target.classList.contains('pk-user-bubble')
  const existingToggle = target.querySelector(':scope > .pk-bubble-toggle') as HTMLButtonElement | null

  if (text.length <= LONG_MESSAGE_THRESHOLD) {
    existingToggle?.remove()
    target.classList.remove('pk-collapsible-bubble', 'pk-bubble-expanded')
    target.setAttribute(ENHANCED_ATTR, 'true')
    return
  }

  target.classList.add('pk-collapsible-bubble')
  target.setAttribute(ENHANCED_ATTR, 'true')
  if (existingToggle) return

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

  // Assistant bubbles keep click-to-expand. User bubbles intentionally do not:
  // their native React click opens the version editor, while See more remains explicit.
  if (!isUserBubble && target.dataset.pkExpandClickBound !== 'true') {
    target.dataset.pkExpandClickBound = 'true'
    target.addEventListener('click', (event) => {
      const clicked = event.target as HTMLElement
      if (clicked.closest('button, textarea, input, select, a')) return
      event.preventDefault()
      event.stopPropagation()
      const expanded = !target.classList.contains('pk-bubble-expanded')
      setExpanded(target, expanded)
    })
  }

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
