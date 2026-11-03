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

function routeLabel(route?: SelfKnowledgeConversationMessage['route']) {
  if (!route) return ''
  const labels = {
    structured: 'Structured data',
    statistical: 'Statistical analysis',
    semantic: 'Semantic retrieval',
    hybrid: 'Hybrid analysis',
    contradiction: 'Possible contradiction analysis',
  }
  return labels[route]
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
          <p>Investigate your preferences using structured data, statistics, semantic retrieval, and evidence-based reasoning.</p>
        </div>

        <div className="hamlet-self-header-side">
          <div className="hamlet-self-conversation-actions" aria-label="Self-Knowledge conversation controls">
            <button className="ghost-button" type="button" onClick={newConversation}>New Conversation</button>
            <button className="ghost-button" type="button" disabled title="Persistent Self-Knowledge conversation history is not part of V1">Conversation History</button>
          </div>
          <div className="hamlet-self-engine-status" aria-label="Hamlet AI Self-Knowledge Engine status">
            <span className="hamlet-model-label">Hamlet AI Self-Knowledge Engine</span>
            <strong>Hybrid Analysis V1</strong>
            <small>Structured Data + Statistical Analysis + Semantic Retrieval + RAG</small>
            <span className="hamlet-self-index-status">
              {syncing
                ? 'Preparing personal knowledge index…'
                : total
                  ? `${indexed}/${total} knowledge documents indexed${pending ? ` · ${pending} pending` : ' · up to date'}`
                  : 'Structured analysis ready · semantic index pending setup'}
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
                {message.role === 'assistant' && message.route && message.evidenceSummary && (
                  <div className="hamlet-self-evidence-meta" aria-label="Evidence used by Hamlet">
                    <span>{routeLabel(message.route)}</span>
                    <span>{message.evidenceSummary.totalWorks} works</span>
                    {message.evidenceSummary.semanticMatches > 0 && <span>{message.evidenceSummary.semanticMatches} semantic matches</span>}
                    {message.evidenceSummary.rankGroups.map((group) => <span key={`${message.id}-${group.label}`}>{group.label}: n={group.sampleSize}</span>)}
                    {message.evidenceSummary.possibleContradictions > 0 && <span>{message.evidenceSummary.possibleContradictions} possible contradictions</span>}
                  </div>
                )}
              </div>
            ))}
            {thinking && (
              <div className="hamlet-message assistant thinking">
                <span>Hamlet</span>
                <p>Building an evidence package<span className="hamlet-dots">...</span></p>
              </div>
            )}
          </div>

          {syncWarning && <div className="hamlet-self-setup-warning">⚠ {syncWarning}</div>}
          {error && <div className="notice error hamlet-error">{error}</div>}
          <div className="hamlet-self-engine-note">
            Supabase remains the source of truth. Embeddings are a derived retrieval layer and are updated only when their source content changes.
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
              placeholder="Ask about your anime preferences, rankings, characters, or patterns…"
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
