import { useEffect } from 'react'
import { loadPersonalKnowledge } from './aiPersonalKnowledge'
import { findManagedWorkByMalId } from './personalCatalogManager'

const nativeTextareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
const TIMESTAMP_CLASS = 'chat-message-timestamp'
const knowledgeTimes = new Map<string, Map<number, string>>()
let knowledgeLoadingKey = ''

function setTextareaValue(target: HTMLTextAreaElement, value: string) {
  if (nativeTextareaSetter) nativeTextareaSetter.call(target, value)
  else target.value = value
  target.dispatchEvent(new Event('input', { bubbles: true }))
  target.dispatchEvent(new Event('change', { bubbles: true }))
}

function formatTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).replace(',', ' ·')
}

function stampHost(host: HTMLElement | null, createdAt: string) {
  if (!host) return
  let stamp = host.querySelector<HTMLElement>(`:scope > .${TIMESTAMP_CLASS}`)
  if (!stamp) {
    stamp = document.createElement('small')
    stamp.className = TIMESTAMP_CLASS
    host.append(stamp)
  }
  stamp.dataset.createdAt = createdAt
  stamp.textContent = formatTimestamp(createdAt)
}

function findWorkChat(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.pk-workspace .pk-chat')
}

function findLatestUserBubble(chat: HTMLElement) {
  return chat.querySelector<HTMLElement>('.pk-message.user .pk-user-bubble')
}

function privacyNode(chat: HTMLElement) {
  return chat.querySelector<HTMLElement>(':scope > .pk-privacy')
}

function existingReplyContainers(chat: HTMLElement) {
  return Array.from(chat.querySelectorAll<HTMLElement>(':scope > .pk-conversation-replies'))
}

function replyContainer(chat: HTMLElement) {
  let container = chat.querySelector<HTMLElement>(':scope > .pk-conversation-replies[data-pk-reply-tail="true"]')
  if (container) return container

  const existing = existingReplyContainers(chat)
  if (existing.length) {
    container = existing.at(-1) ?? null
    if (container) {
      container.dataset.pkReplyTail = 'true'
      return container
    }
  }

  container = document.createElement('div')
  container.className = 'pk-conversation-replies'
  container.dataset.pkReplyTail = 'true'
  chat.insertBefore(container, privacyNode(chat) ?? null)
  return container
}

function rotateReplyTail(chat: HTMLElement) {
  existingReplyContainers(chat).forEach((container) => delete container.dataset.pkReplyTail)
  const container = document.createElement('div')
  container.className = 'pk-conversation-replies'
  container.dataset.pkReplyTail = 'true'
  chat.insertBefore(container, privacyNode(chat) ?? null)
  return container
}

function moveEditBlockBeforeTail(chat: HTMLElement, tail: HTMLElement) {
  const userMessage = chat.querySelector<HTMLElement>(':scope > .pk-message.user')
  const versionNav = chat.querySelector<HTMLElement>(':scope > .pk-version-nav')
  const compose = chat.querySelector<HTMLElement>(':scope > .pk-compose-actions')
  const warning = chat.querySelector<HTMLElement>(':scope > .pk-inline-warning')
  ;[userMessage, versionNav, compose, warning].forEach((node) => {
    if (node) chat.insertBefore(node, tail)
  })
}

function beginEditingTimeline(chat: HTMLElement) {
  const oldTail = replyContainer(chat)
  const anchor = privacyNode(chat)
  const userMessage = chat.querySelector<HTMLElement>(':scope > .pk-message.user')
  const versionNav = chat.querySelector<HTMLElement>(':scope > .pk-version-nav')
  const compose = chat.querySelector<HTMLElement>(':scope > .pk-compose-actions')
  const warning = chat.querySelector<HTMLElement>(':scope > .pk-inline-warning')

  ;[userMessage, versionNav, compose, warning].forEach((node) => {
    if (node) chat.insertBefore(node, anchor ?? null)
  })

  const newTail = rotateReplyTail(chat)
  moveEditBlockBeforeTail(chat, newTail)
  chat.dataset.pkEditingTimeline = 'true'
  oldTail.dataset.pkReplyHistory = 'true'
  window.requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight })
}

function syncEditingTimeline(chat: HTMLElement) {
  const editing = Boolean(chat.querySelector('.pk-message.user .pk-user-bubble textarea'))
  const wasEditing = chat.dataset.pkEditingTimeline === 'true'

  if (editing && !wasEditing) {
    beginEditingTimeline(chat)
    return
  }

  if (editing) {
    const tail = replyContainer(chat)
    moveEditBlockBeforeTail(chat, tail)
    return
  }

  if (wasEditing) chat.dataset.pkEditingTimeline = 'false'
}

function waitForChatEditor(chat: HTMLElement, callback: (textarea: HTMLTextAreaElement) => void, attempts = 0) {
  const textarea = chat.querySelector<HTMLTextAreaElement>('.pk-message.user .pk-user-bubble textarea')
  if (textarea) {
    syncEditingTimeline(chat)
    callback(textarea)
    return
  }
  if (attempts >= 12) return
  window.requestAnimationFrame(() => waitForChatEditor(chat, callback, attempts + 1))
}

function openLatestCommentEditor(chat: HTMLElement, callback?: (textarea: HTMLTextAreaElement) => void) {
  const backToWork = chat.querySelector<HTMLButtonElement>('.pk-back')
  if (backToWork) {
    backToWork.click()
    window.requestAnimationFrame(() => openLatestCommentEditor(chat, callback))
    return
  }

  const versionNav = chat.querySelector<HTMLElement>('.pk-version-nav')
  const rightArrow = Array.from(versionNav?.querySelectorAll<HTMLButtonElement>('button') ?? []).find((button) => button.textContent?.trim() === '→')
  if (rightArrow && !rightArrow.disabled) {
    rightArrow.click()
    window.requestAnimationFrame(() => openLatestCommentEditor(chat, callback))
    return
  }

  const existing = chat.querySelector<HTMLTextAreaElement>('.pk-message.user .pk-user-bubble textarea')
  if (existing) {
    syncEditingTimeline(chat)
    callback?.(existing)
    existing.focus()
    return
  }

  const bubble = findLatestUserBubble(chat)
  if (!bubble) return
  bubble.click()
  waitForChatEditor(chat, (textarea) => {
    callback?.(textarea)
    textarea.focus()
  })
}

function appendConversationReply(chat: HTMLElement, text: string) {
  const normalized = text.trim()
  if (!normalized) return
  const container = replyContainer(chat)
  const last = container.lastElementChild?.querySelector('p')?.textContent?.trim()
  if (last === normalized) return

  const createdAt = new Date().toISOString()
  const message = document.createElement('div')
  message.className = 'pk-message assistant pk-conversation-reply'
  message.dataset.pkCreatedAt = createdAt
  const avatar = document.createElement('span')
  avatar.className = 'pk-avatar'
  avatar.textContent = 'AI'
  const body = document.createElement('div')
  const paragraph = document.createElement('p')
  paragraph.textContent = normalized
  body.append(paragraph)
  stampHost(body, createdAt)
  message.append(avatar, body)
  container.append(message)
  window.requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight })
}

function enhanceConversationThread(chat: HTMLElement) {
  let dynamic = chat.querySelector<HTMLElement>(':scope > .pk-message.assistant[data-pk-dynamic-assistant="true"]')
  if (!dynamic) {
    const candidate = Array.from(chat.children).find((child) => child instanceof HTMLElement && child.classList.contains('pk-message') && child.classList.contains('assistant') && !child.classList.contains('pk-thread-intro') && !child.classList.contains('pk-conversation-reply'))
    dynamic = candidate instanceof HTMLElement ? candidate : null
    if (!dynamic) return

    const initial = dynamic.querySelector('p')?.textContent?.trim() ?? ''
    const createdAt = new Date().toISOString()
    dynamic.dataset.pkDynamicAssistant = 'true'
    dynamic.dataset.pkLastAssistant = initial
    dynamic.dataset.pkCreatedAt = createdAt

    const intro = dynamic.cloneNode(true) as HTMLElement
    intro.classList.add('pk-thread-intro')
    intro.removeAttribute('data-pk-dynamic-assistant')
    intro.removeAttribute('data-pk-last-assistant')
    intro.dataset.pkCreatedAt = createdAt
    intro.querySelectorAll('.pk-thinking, .pk-bubble-toggle, .chat-message-timestamp').forEach((node) => node.remove())
    const introParagraph = intro.querySelector('p')
    if (introParagraph) introParagraph.textContent = initial
    stampHost(intro.querySelector<HTMLElement>(':scope > div'), createdAt)
    dynamic.before(intro)
    dynamic.classList.add('pk-dynamic-assistant-hidden')
  }

  const current = dynamic.querySelector('p')?.textContent?.trim() ?? ''
  const previous = dynamic.dataset.pkLastAssistant ?? ''
  if (current && current !== previous) {
    dynamic.dataset.pkLastAssistant = current
    appendConversationReply(chat, current)
  }
}

function stampAssistantMessages(chat: HTMLElement) {
  chat.querySelectorAll<HTMLElement>('.pk-message.assistant:not(.pk-dynamic-assistant-hidden)').forEach((message) => {
    const body = message.querySelector<HTMLElement>(':scope > div')
    if (!body || body.querySelector(`:scope > .${TIMESTAMP_CLASS}`)) return
    const createdAt = message.dataset.pkCreatedAt || new Date().toISOString()
    message.dataset.pkCreatedAt = createdAt
    stampHost(body, createdAt)
  })
}

function currentMalId() {
  const match = window.location.hash.match(/\/app\/anime\/(\d+)/)
  return match ? Number(match[1]) : null
}

function currentUserVersion(chat: HTMLElement) {
  const label = chat.querySelector<HTMLElement>('.pk-message.user .pk-user-bubble > small:not(.chat-message-timestamp)')?.textContent ?? ''
  const match = label.match(/V(\d+)/i)
  return match ? Number(match[1]) : null
}

async function refreshUserTimestamp(chat: HTMLElement) {
  const bubble = findLatestUserBubble(chat)
  if (!bubble) return
  const version = currentUserVersion(chat)
  if (version == null) {
    if (!bubble.querySelector(`:scope > .${TIMESTAMP_CLASS}`)) stampHost(bubble, new Date().toISOString())
    return
  }

  const malId = currentMalId()
  const work = malId == null ? null : findManagedWorkByMalId(malId)
  if (!work) return

  const cached = knowledgeTimes.get(work.id)?.get(version)
  if (cached) {
    stampHost(bubble, cached)
    return
  }

  const requestKey = `${work.id}:v${version}`
  if (knowledgeLoadingKey === requestKey) return
  knowledgeLoadingKey = requestKey
  try {
    const fallback = bubble.querySelector('p')?.textContent ?? bubble.querySelector('textarea')?.value ?? ''
    const profile = await loadPersonalKnowledge(work.id, work.primaryMalId, fallback)
    const times = new Map(profile.versions.map((row) => [row.versionNumber, row.createdAt]))
    knowledgeTimes.set(work.id, times)
    const createdAt = times.get(version)
    if (createdAt && document.body.contains(bubble)) stampHost(bubble, createdAt)
  } catch {
    if (!bubble.querySelector(`:scope > .${TIMESTAMP_CLASS}`)) stampHost(bubble, new Date().toISOString())
  } finally {
    if (knowledgeLoadingKey === requestKey) knowledgeLoadingKey = ''
  }
}

function enhanceVersionEdit(chat: HTMLElement) {
  const nav = chat.querySelector<HTMLElement>('.pk-version-nav')
  if (!nav || nav.querySelector('.pk-version-edit-button')) return
  const label = nav.querySelector('span')
  if (!label) return

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'pk-version-edit-button'
  button.textContent = '✎'
  button.title = 'Edit current comment'
  button.setAttribute('aria-label', 'Edit current comment')
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    openLatestCommentEditor(chat)
  })
  label.after(button)
}

function enhanceContextActions(chat: HTMLElement) {
  chat.querySelectorAll<HTMLElement>('.pk-context-actions').forEach((actions) => {
    const buttons = Array.from(actions.querySelectorAll<HTMLButtonElement>('button'))
    const workActions = buttons.some((button) => button.textContent?.includes('Identify characters'))
    if (!workActions) return

    const button = buttons.find((candidate) => candidate.textContent?.includes('Organize text with AI'))
    if (!button) return
    button.textContent = '✏️ Edit current comment'
    if (button.dataset.pkEditActionBound === 'true') return
    button.dataset.pkEditActionBound = 'true'
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      appendConversationReply(chat, 'Current comment opened for editing. Save it to create a new version.')
      openLatestCommentEditor(chat)
    })
  })
}

function latestVersionNumber(chat: HTMLElement) {
  const text = chat.querySelector('.pk-version-nav span')?.textContent ?? ''
  const match = text.match(/\/\s*V(\d+)/i)
  return match ? Number(match[1]) : 0
}

function cleanupProfileEditor(card: HTMLElement) {
  card.querySelector('.pk-comment-inline-editor')?.remove()
  card.querySelector(':scope > p')?.classList.remove('pk-comment-display-hidden')
}

function mountProfileEditor(card: HTMLElement, chat: HTMLElement, chatTextarea: HTMLTextAreaElement) {
  if (card.querySelector('.pk-comment-inline-editor')) return
  const paragraph = card.querySelector<HTMLParagraphElement>(':scope > p')
  paragraph?.classList.add('pk-comment-display-hidden')

  const editor = document.createElement('div')
  editor.className = 'pk-comment-inline-editor'
  const textarea = document.createElement('textarea')
  textarea.value = chatTextarea.value
  textarea.setAttribute('aria-label', 'Edit current comment')
  textarea.addEventListener('input', () => setTextareaValue(chatTextarea, textarea.value))

  const actions = document.createElement('div')
  actions.className = 'pk-comment-inline-actions'
  const save = document.createElement('button')
  save.type = 'button'
  save.className = 'primary-button compact'
  const currentVersion = latestVersionNumber(chat)
  save.textContent = `Save as V${Math.max(currentVersion + 1, 1)}`
  save.addEventListener('click', () => {
    setTextareaValue(chatTextarea, textarea.value)
    const saveButton = chat.querySelector<HTMLButtonElement>('.pk-compose-actions .primary-button')
    saveButton?.click()
    save.disabled = true
    save.textContent = 'Saving…'
  })

  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.className = 'text-button'
  cancel.textContent = 'Cancel'
  cancel.addEventListener('click', () => {
    chat.querySelector<HTMLButtonElement>('.pk-compose-actions .text-button')?.click()
    cleanupProfileEditor(card)
  })

  actions.append(save, cancel)
  editor.append(textarea, actions)
  card.append(editor)
  textarea.focus()
}

function enhanceCurrentCommentCard(chat: HTMLElement) {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.pk-profile > .ai-profile-card'))
  const card = cards.find((candidate) => candidate.querySelector('.ai-profile-card-title')?.textContent?.toLowerCase().includes('current comment'))
  if (!card) return

  card.classList.add('pk-comment-editable-card')
  const title = card.querySelector<HTMLElement>('.ai-profile-card-title')
  const paragraph = card.querySelector<HTMLParagraphElement>(':scope > p')
  if (!title || !paragraph) return

  let editButton = title.querySelector<HTMLButtonElement>('.pk-comment-edit-button')
  if (!editButton) {
    editButton = document.createElement('button')
    editButton.type = 'button'
    editButton.className = 'pk-comment-edit-button'
    editButton.textContent = '✎'
    editButton.title = 'Edit current comment'
    editButton.setAttribute('aria-label', 'Edit current comment')
    editButton.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      openLatestCommentEditor(chat, (textarea) => mountProfileEditor(card, chat, textarea))
    })
    title.append(editButton)
  }

  if (paragraph.dataset.pkCommentEditBound !== 'true') {
    paragraph.dataset.pkCommentEditBound = 'true'
    paragraph.title = 'Click to edit current comment'
    paragraph.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      openLatestCommentEditor(chat, (textarea) => mountProfileEditor(card, chat, textarea))
    })
  }

  const inlineEditor = card.querySelector('.pk-comment-inline-editor')
  const chatTextarea = chat.querySelector<HTMLTextAreaElement>('.pk-message.user .pk-user-bubble textarea')
  if (inlineEditor && !chatTextarea) cleanupProfileEditor(card)
}

function enhanceWorkspace() {
  const chat = findWorkChat()
  if (!chat) return
  enhanceConversationThread(chat)
  syncEditingTimeline(chat)
  enhanceVersionEdit(chat)
  enhanceContextActions(chat)
  enhanceCurrentCommentCard(chat)
  stampAssistantMessages(chat)
  void refreshUserTimestamp(chat)
}

export default function PersonalKnowledgeCommentHotfixEnhancer() {
  useEffect(() => {
    let frame = 0
    const schedule = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(enhanceWorkspace)
    }

    enhanceWorkspace()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
    }
  }, [])

  return null
}
