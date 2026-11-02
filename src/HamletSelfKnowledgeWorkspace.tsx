import { FormEvent, useState } from 'react'

export default function HamletSelfKnowledgeWorkspace() {
  const [draft, setDraft] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
  }

  return (
    <section className="hamlet-workspace hamlet-self-knowledge-workspace" aria-label="Hamlet AI Self-Knowledge">
      <header className="hamlet-header">
        <div>
          <span className="eyebrow">✨ HAMLET AI</span>
          <div data-hamlet-mode-selector-host className="hamlet-dual-mode-selector-host" />
          <h2>Self-Knowledge</h2>
          <p>Explore your personal anime knowledge, preferences, rankings, characters, themes, keywords, and patterns.</p>
        </div>

        <div className="hamlet-self-header-side">
          <div className="hamlet-self-conversation-actions" aria-label="Prepared Self-Knowledge conversation controls">
            <button className="ghost-button" type="button" disabled title="Available when the Self-Knowledge Engine is connected">New Conversation</button>
            <button className="ghost-button" type="button" disabled title="Available when the Self-Knowledge Engine is connected">Conversation History</button>
          </div>
          <div className="hamlet-self-engine-status" aria-label="Hamlet AI Self-Knowledge Engine status">
            <span className="hamlet-model-label">Hamlet AI Self-Knowledge Engine</span>
            <strong>UI prepared</strong>
            <small>Engine connection will be added in a later step.</small>
          </div>
        </div>
      </header>

      <div className="hamlet-self-conversation-only">
        <section className="hamlet-conversation-panel">
          <div className="hamlet-panel-heading">
            <span className="eyebrow">CONVERSATION</span>
            <strong>Talk to Hamlet</strong>
          </div>

          <div className="hamlet-messages hamlet-self-messages">
            <div className="hamlet-message assistant">
              <span>Hamlet</span>
              <p>Ask Hamlet about your anime preferences, rankings, favorite characters, themes, or patterns in your personal catalog.</p>
            </div>
          </div>

          <div className="hamlet-self-engine-note">Visual preparation only — no Self-Knowledge Engine requests are sent in this version.</div>

          <form className="hamlet-composer" onSubmit={submit}>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask about your anime preferences, rankings, characters, or patterns…"
              rows={2}
              aria-label="Message Hamlet Self-Knowledge"
            />
            <button
              className="primary-button"
              type="submit"
              disabled
              title="Hamlet AI Self-Knowledge Engine will be connected in a later step."
              aria-label="Send unavailable until the Self-Knowledge Engine is connected"
            >
              ➤
            </button>
          </form>
        </section>
      </div>
    </section>
  )
}
