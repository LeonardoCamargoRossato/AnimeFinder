import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { selfKnowledgeService } from './SelfKnowledgeService'
import type {
  SelfKnowledgeConversationMessage,
  SelfKnowledgeIndexCoverage,
  SelfKnowledgeSyncStatus,
} from './selfKnowledgeTypes'

const now = () => new Date().toISOString()
const makeMessage = (
  role: SelfKnowledgeConversationMessage['role'],
  content: string,
): SelfKnowledgeConversationMessage => ({ id: crypto.randomUUID(), role, content, createdAt: now() })

const intro = () => makeMessage(
  'assistant',
  'Ask Hamlet about your anime preferences, rankings, favorite characters, themes, or patterns in your personal catalog.',
)

function formatTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

function coverageFromSync(status: SelfKnowledgeSyncStatus | null): SelfKnowledgeIndexCoverage | null {
  if (!status) return null
  return {
    totalDerivedDocuments: status.sync.totalDerivedDocuments,
    indexedDocuments: Number(status.sync.status?.embedded) || 0,
    pendingEmbeddings: status.sync.pendingEmbeddings,
    embeddedThisRequest: status.sync.embeddedThisRequest,
  }
}

export default function HamletSelfKnowledgeWorkspace() {
  const [messages, setMessages] = useState<SelfKnowledgeConversationMessage[]>(() => [intro()])
  const [draft, setDraft] = useState('')
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState('')
  const [syncStatus, setSyncStatus] = useState<SelfKnowledgeSyncStatus | null>(null)
  const [syncing, setSyncing] = useState(true)
  const [syncWarning, setSyncWarning] = useState('')
  const messagesRef = useRef<HTMLDivElement | null>(null)

  const latestCoverage = useMemo(() => {
    const messageCoverage = [...messages].reverse().find((message) => message.index)?.index ?? null
    return messageCoverage ?? coverageFromSync(syncStatus)
  }, [messages, syncStatus])

  useEffect(() => {
    let cancelled = false
    void selfKnowledgeService.sync(12)
      .then((status) => {
        if (!cancelled) {
          setSyncStatus(status)
          setSyncWarning('')
        }
      })
      .catch((reason) => {
        if (!cancelled) setSyncWarning(reason instanceof Error ? reason.message : 'Knowledge index sync is temporarily unavailable.')
      })
      .finally(() => { if (!cancelled) setSyncing(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const node = messagesRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages, thinking])

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    const text = draft.trim()
    if (!text || thinking) return

    const userMessage = makeMessage('user', text)
    const priorConversation = messages
    setMessages((current) => [...current, userMessage])
    setDraft('')
    setError('')
    setThinking(true)

    try {
      const answer = await selfKnowledgeService.ask(text, priorConversation)
      const assistantMessage: SelfKnowledgeConversationMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: answer.reply,
        createdAt: now(),
        modelUsed: answer.model,
        route: answer.route,
        evidenceSummary: answer.evidenceSummary,
        index: answer.index,
      }
      setMessages((current) => [...current, assistantMessage])
      setSyncWarning('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Hamlet Self-Knowledge is temporarily unavailable.')
    } finally {
      setThinking(false)
    }
  }

  function newConversation() {
    setMessages([intro()])
    setDraft('')
    setError('')
  }

  const indexed = latestCoverage?.indexedDocuments ?? 0
  const total = latestCoverage?.totalDerivedDocuments ?? 0
  const pending = latestCoverage?.pendingEmbeddings ?? 0

  return (
    <section className="hamlet-workspace hamlet-self-knowledge-workspace" aria-label="Hamlet AI Self-Knowledge">
      <header className="hamlet-header">
        <div>
          <span className="eyebrow">✨ HAMLET AI</span>
          <div data-hamlet-mode-selector-host className="hamlet-dual-mode-selector-host" />
          <h2>Self-Knowledge</h2>
          <p>Talk with Hamlet about what your anime choices, characters, comments, and rankings may reveal about your preferences.</p>
        </div>

        <div className="hamlet-self-header-side">
          <div className="hamlet-self-conversation-actions" aria-label="Self-Knowledge conversation controls">
            <button className="ghost-button" type="button" onClick={newConversation}>New Conversation</button>
            <button className="ghost-button" type="button" disabled title="Persistent Self-Knowledge conversation history is not part of V1">Conversation History</button>
          </div>
          <div className="hamlet-self-engine-status" aria-label="Hamlet AI Self-Knowledge Engine status">
            <span className="hamlet-model-label">Hamlet AI Self-Knowledge Engine</span>
            <strong>Personal knowledge ready</strong>
            <small>Hamlet uses your catalog as evidence and turns it into conversational interpretations.</small>
            <span className="hamlet-self-index-status">
              {syncing
                ? 'Preparing personal knowledge…'
                : total
                  ? `${indexed}/${total} knowledge documents ready${pending ? ` · ${pending} still preparing` : ''}`
                  : 'Personal knowledge is ready for structured analysis'}
            </span>
          </div>
        </div>
      </header>

      <div className="hamlet-self-conversation-only">
        <section className="hamlet-conversation-panel">
          <div className="hamlet-panel-heading">
            <span className="eyebrow">CONVERSATION</span>
            <strong>Talk to Hamlet</strong>
          </div>

          <div className="hamlet-messages hamlet-self-messages" ref={messagesRef}>
            {messages.map((message) => (
              <div key={message.id} className={`hamlet-message ${message.role}`}>
                <span>{message.role === 'assistant' ? 'Hamlet' : 'You'}</span>
                <p>{message.content}</p>
                <small className="hamlet-self-message-time">{formatTimestamp(message.createdAt)}</small>
              </div>
            ))}
            {thinking && (
              <div className="hamlet-message assistant thinking">
                <span>Hamlet</span>
                <p>Thinking about what your catalog suggests<span className="hamlet-dots">...</span></p>
              </div>
            )}
          </div>

          {syncWarning && <div className="hamlet-self-setup-warning">⚠ {syncWarning}</div>}
          {error && <div className="notice error hamlet-error">{error}</div>}
          <div className="hamlet-self-engine-note">
            Your catalog remains the source of truth. Hamlet uses it as evidence without turning every answer into a report.
          </div>

          <form className="hamlet-composer" onSubmit={(event) => void submit(event)}>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submit()
                }
              }}
              placeholder="Ask what seems to matter to you in anime, characters, themes, or stories…"
              rows={2}
              aria-label="Message Hamlet Self-Knowledge"
            />
            <button className="primary-button" type="submit" disabled={!draft.trim() || thinking} aria-label="Send to Hamlet Self-Knowledge">➤</button>
          </form>
        </section>
      </div>
    </section>
  )
}
