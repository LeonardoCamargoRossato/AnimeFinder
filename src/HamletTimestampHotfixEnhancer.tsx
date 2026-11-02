import { useEffect } from 'react'
import { loadHamletConversation, loadLatestHamletConversation } from './hamletPersistence'
import type { HamletMessage } from './hamletTypes'

const TIMESTAMP_CLASS = 'chat-message-timestamp'
let inFlight = false
let lastSignature = ''
let retryTimer = 0

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

function messageRole(node: HTMLElement): HamletMessage['role'] {
  return node.classList.contains('user') ? 'user' : 'assistant'
}

function messageText(node: HTMLElement) {
  return node.querySelector('p')?.textContent?.trim() ?? ''
}

function stamp(node: HTMLElement, createdAt: string, source: 'persisted' | 'session') {
  let target = node.querySelector<HTMLElement>(`:scope > .${TIMESTAMP_CLASS}`)
  if (!target) {
    target = document.createElement('small')
    target.className = TIMESTAMP_CLASS
    node.append(target)
  }
  target.dataset.createdAt = createdAt
  target.dataset.timestampSource = source
  target.textContent = formatTimestamp(createdAt)
}

function messageNodes() {
  const panel = document.querySelector<HTMLElement>('.hamlet-messages')
  if (!panel) return [] as HTMLElement[]
  return Array.from(panel.querySelectorAll<HTMLElement>(':scope > .hamlet-message:not(.thinking)'))
}

function signatureFor(nodes: HTMLElement[]) {
  return nodes.map((node) => `${messageRole(node)}:${messageText(node)}`).join('\n---\n')
}

function stampSessionFallback(nodes: HTMLElement[]) {
  const now = new Date().toISOString()
  nodes.forEach((node) => {
    const existing = node.querySelector<HTMLElement>(`:scope > .${TIMESTAMP_CLASS}`)
    if (existing) return
    const createdAt = node.dataset.hamletFirstSeenAt || now
    node.dataset.hamletFirstSeenAt = createdAt
    stamp(node, createdAt, 'session')
  })
}

function matchPersistedMessages(nodes: HTMLElement[], messages: HamletMessage[]) {
  let cursor = 0
  for (const node of nodes) {
    const role = messageRole(node)
    const content = messageText(node)
    let found = -1
    for (let index = cursor; index < messages.length; index += 1) {
      if (messages[index].role === role && messages[index].content.trim() === content) {
        found = index
        break
      }
    }
    if (found < 0) continue
    const message = messages[found]
    stamp(node, message.createdAt, 'persisted')
    cursor = found + 1
  }
}

async function syncHamletTimestamps(force = false) {
  const nodes = messageNodes()
  if (!nodes.length) return

  stampSessionFallback(nodes)
  const signature = signatureFor(nodes)
  if (!force && signature === lastSignature) return
  lastSignature = signature
  if (inFlight) return

  inFlight = true
  try {
    const latest = await loadLatestHamletConversation()
    if (!latest) return
    const snapshot = await loadHamletConversation(latest.id)
    if (!snapshot.messages.length) return
    matchPersistedMessages(nodes, snapshot.messages)
  } catch {
    // Session timestamps remain visible if persistent history is temporarily unavailable.
  } finally {
    inFlight = false
    window.clearTimeout(retryTimer)
    retryTimer = window.setTimeout(() => { void syncHamletTimestamps(true) }, 650)
  }
}

export default function HamletTimestampHotfixEnhancer() {
  useEffect(() => {
    let frame = 0
    const schedule = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => { void syncHamletTimestamps() })
    }

    void syncHamletTimestamps(true)
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
      window.clearTimeout(retryTimer)
    }
  }, [])

  return null
}
