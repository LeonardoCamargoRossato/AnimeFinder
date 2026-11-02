import { FormEvent, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { hamletAIProvider } from './GeminiProvider'
import HamletConversationHistory from './HamletConversationHistory'
import { applyHamletCatalogAction, type HamletCatalogAction } from './hamletCatalogActions'
import { searchHamletAnime } from './hamletSearchService'
import { DEFAULT_HAMLET_GEMINI_MODEL, HAMLET_GEMINI_MODELS, HAMLET_PROVIDER_OPTIONS, hamletModelLabel } from './hamletModels'
import {
  applyHamletAiMetadata,
  archiveHamletConversation,
  createHamletConversation,
  listHamletConversations,
  loadHamletConversation,
  loadLatestHamletConversation,
  persistHamletMessage,
  persistHamletRecommendations,
  persistHamletState,
  recordHamletRecommendationAction,
  touchHamletConversation,
  type HamletConversationSummary,
} from './hamletPersistence'
import { emptyHamletIntent, type HamletMessage, type HamletRecommendation, type HamletSearchIntent } from './hamletTypes'

const now = () => new Date().toISOString()
const makeMessage = (role: HamletMessage['role'], content: string, modelUsed?: string): HamletMessage => ({ id: crypto.randomUUID(), role, content, createdAt: now(), modelUsed })
const intro = () => makeMessage('assistant', 'Tell me what you feel like watching. I can clarify anime concepts and turn your answers into real AnimeFinder search criteria.')

function HamletAnimeCard({ recommendation, onMarkWatched }: { recommendation: HamletRecommendation; onMarkWatched: () => void }) {
  const navigate = useNavigate()
  const { anime } = recommendation
  const actionLabel = recommendation.catalogAction === 'needs_classification'
    ? 'Needs classification'
    : recommendation.watched || recommendation.catalogAction === 'watched'
      ? '✓ Watched'
      : 'Mark as Watched'
  return <article className="hamlet-compact-card">
    <button className="hamlet-compact-poster" onClick={() => navigate(`/app/anime/${anime.malId}`)} aria-label={`Open ${anime.title}`}>
      {anime.imageUrl ? <img src={anime.imageUrl} alt={anime.title} loading="lazy" /> : <div className="poster-placeholder">No image</div>}
      <span>★ {anime.score?.toFixed(1) ?? '—'}</span>
    </button>
    <div className="hamlet-compact-copy">
      <button className="hamlet-compact-title" onClick={() => navigate(`/app/anime/${anime.malId}`)}>{anime.title}</button>
      <div className="hamlet-compact-meta">{[anime.year ?? '—', anime.type ?? 'Anime', anime.episodes ? `${anime.episodes} ep` : null].filter(Boolean).join(' · ')}</div>
      <div className="hamlet-compact-genres">{anime.genres.slice(0, 3).map((genre) => <span key={genre.id}>{genre.name}</span>)}</div>
      <p className="hamlet-compact-why">{recommendation.whyMatches}</p>
      <button className={`hamlet-watch-action ${recommendation.catalogAction || recommendation.watched ? 'done' : ''}`} onClick={onMarkWatched} disabled={recommendation.catalogAction === 'watched' || recommendation.watched}>{actionLabel}</button>
    </div>
  </article>
}

function WatchedChoiceDialog({ title, busy, onChoose, onClose }: { title: string; busy: boolean; onChoose: (action: HamletCatalogAction) => void; onClose: () => void }) {
  return createPortal(<div className="hamlet-watch-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose() }}>
    <section className="hamlet-watch-dialog" role="dialog" aria-modal="true" aria-label="Classify watched anime">
      <span className="eyebrow">MARK AS WATCHED</span><h3>How should this anime be added?</h3><p>{title}</p>
      <button className="primary-button" onClick={() => onChoose('watched')} disabled={busy}>Already classified</button>
      <button className="ghost-button" onClick={() => onChoose('needs_classification')} disabled={busy}>Needs classification</button>
      <button className="ghost-button" onClick={onClose} disabled={busy}>Cancel</button>
    </section>
  </div>, document.body)
}

function intentChips(intent: HamletSearchIntent) {
  return [
    ...intent.genres.map((value) => ({ kind: 'genres' as const, value, label: value })),
    ...intent.themes.map((value) => ({ kind: 'themes' as const, value, label: value })),
    ...intent.concepts.map((value) => ({ kind: 'concepts' as const, value, label: value })),
    ...intent.avoidGenres.map((value) => ({ kind: 'avoidGenres' as const, value, label: `Avoid ${value}` })),
    ...intent.avoidConcepts.map((value) => ({ kind: 'avoidConcepts' as const, value, label: `Avoid ${value}` })),
  ]
}

function HamletModelSelector({ displayedModel, preferredModel, fallbackUsed, onSelect }: { displayedModel: string; preferredModel: string; fallbackUsed: boolean; onSelect: (model: string) => void }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'providers' | 'gemini'>('providers')
  function close() { setOpen(false); setView('providers') }
  return <div className="hamlet-model-control">
    <span className="hamlet-model-label">Model</span>
    <button className="hamlet-model-button" onClick={() => { setOpen((value) => !value); setView('providers') }} aria-expanded={open}><span>{hamletModelLabel(displayedModel)}</span><b>⌄</b></button>
    {fallbackUsed && <small className="hamlet-fallback-note" title="Fallback model — preferred model temporarily unavailable.">Fallback model</small>}
    {displayedModel !== preferredModel && <small className="hamlet-preferred-note">Preferred: {hamletModelLabel(preferredModel)}</small>}
    {open && <div className="hamlet-model-popover" role="dialog" aria-label="Hamlet model selector">
      {view === 'providers' ? <><div className="hamlet-model-popover-title">AI Provider</div>{HAMLET_PROVIDER_OPTIONS.map((provider) => provider.available
        ? <button key={provider.id} className="hamlet-provider-option available" onClick={() => setView('gemini')}><span>{provider.label}</span><small>Available</small><b>›</b></button>
        : <div key={provider.id} className="hamlet-provider-disabled" data-tooltip="Provider not available yet."><button className="hamlet-provider-option" disabled><span>{provider.label}</span><small>Unavailable</small></button></div>)}</>
        : <><button className="hamlet-model-back" onClick={() => setView('providers')}>← Providers</button><div className="hamlet-model-popover-title">Gemini models</div>{HAMLET_GEMINI_MODELS.map((model) => <button key={model.id} className={`hamlet-model-option ${preferredModel === model.id ? 'preferred' : ''}`} onClick={() => { onSelect(model.id); close() }}><span>{model.label}</span><small>{preferredModel === model.id ? 'Preferred' : 'Use as preferred'}</small></button>)}</>}
    </div>}
  </div>
}

export default function HamletAIWorkspace() {
  const [messages, setMessages] = useState<HamletMessage[]>(() => [intro()])
  const [intent, setIntent] = useState<HamletSearchIntent>(emptyHamletIntent)
  const [draft, setDraft] = useState('')
  const [recommendations, setRecommendations] = useState<HamletRecommendation[]>([])
  const [thinking, setThinking] = useState(false)
  const [searching, setSearching] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState('')
  const [persistenceWarning, setPersistenceWarning] = useState('')
  const [preferredModel, setPreferredModel] = useState(DEFAULT_HAMLET_GEMINI_MODEL)
  const [lastSuccessfulModel, setLastSuccessfulModel] = useState<string | null>(null)
  const [fallbackUsed, setFallbackUsed] = useState(false)
  const [conversation, setConversation] = useState<HamletConversationSummary | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [watchIndex, setWatchIndex] = useState<number | null>(null)
  const [watchBusy, setWatchBusy] = useState(false)
  const chips = useMemo(() => intentChips(intent), [intent])
  const displayedModel = lastSuccessfulModel ?? preferredModel

  async function runSearch(nextIntent: HamletSearchIntent, conversationId?: string | null) {
    if (!nextIntent.readyToSearch) {
      setRecommendations([])
      if (conversationId) void persistHamletRecommendations(conversationId, []).catch(() => undefined)
      return [] as HamletRecommendation[]
    }
    setSearching(true)
    try {
      const next = await searchHamletAnime(nextIntent)
      setRecommendations(next)
      if (conversationId) void persistHamletRecommendations(conversationId, next).catch((reason) => setPersistenceWarning(reason instanceof Error ? reason.message : 'Recommendations could not be persisted.'))
      return next
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not search the anime catalog right now.')
      return [] as HamletRecommendation[]
    } finally { setSearching(false) }
  }

  async function restoreConversation(conversationId: string, countAccess = true) {
    if (conversation?.id === conversationId && countAccess) return
    setRestoring(true); setError(''); setPersistenceWarning('')
    try {
      const touched = countAccess ? await touchHamletConversation(conversationId) : null
      const snapshot = await loadHamletConversation(conversationId)
      const summary = touched ?? snapshot.conversation
      setConversation(summary)
      setMessages(snapshot.messages.length ? snapshot.messages : [intro()])
      setIntent(summary.currentIntent)
      setPreferredModel(summary.preferredModel || DEFAULT_HAMLET_GEMINI_MODEL)
      setLastSuccessfulModel(summary.lastModelUsed)
      setFallbackUsed(false)
      await runSearch(summary.currentIntent, conversationId)
    } catch (reason) {
      setPersistenceWarning(reason instanceof Error ? reason.message : 'Could not restore Hamlet conversation from Supabase.')
    } finally { setRestoring(false) }
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const latest = await loadLatestHamletConversation()
        if (!cancelled && latest?.status === 'active') await restoreConversation(latest.id, true)
      } catch (reason) {
        if (!cancelled) setPersistenceWarning(reason instanceof Error ? reason.message : 'Persistent Hamlet history is not available yet.')
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function ensureConversation() {
    if (conversation) return conversation
    try {
      const created = await createHamletConversation(preferredModel)
      setConversation(created)
      setPersistenceWarning('')
      return created
    } catch (reason) {
      setPersistenceWarning(reason instanceof Error ? reason.message : 'Could not start persistent Hamlet conversation.')
      return null
    }
  }

  async function send(event?: FormEvent) {
    event?.preventDefault()
    const message = draft.trim()
    if (!message || thinking) return
    const userMessage = makeMessage('user', message)
    const priorMessages = messages
    setMessages((current) => [...current, userMessage]); setDraft(''); setThinking(true); setError('')
    const activeConversation = await ensureConversation()
    if (activeConversation) {
      try { await persistHamletMessage(activeConversation.id, userMessage) }
      catch (reason) { setPersistenceWarning(reason instanceof Error ? reason.message : 'Your message could not be persisted.') }
    }
    try {
      const response = await hamletAIProvider.sendMessage({
        message,
        conversation: priorMessages.map(({ role, content }) => ({ role, content })),
        currentIntent: intent,
        preferredModel,
        conversationMetadata: {
          title: activeConversation?.title ?? conversation?.title ?? null,
          description: activeConversation?.description ?? conversation?.description ?? null,
          titleSource: activeConversation?.titleSource ?? conversation?.titleSource ?? 'pending',
        },
      })
      const actualModel = response.model ?? preferredModel
      const assistantMessage = makeMessage('assistant', response.reply, actualModel)
      setMessages((current) => [...current, assistantMessage])
      setIntent(response.intent)
      setLastSuccessfulModel(actualModel)
      setFallbackUsed(response.fallbackUsed === true || actualModel !== preferredModel)
      const conversationId = activeConversation?.id ?? conversation?.id ?? null
      if (conversationId) {
        setConversation((current) => current ? { ...current, currentIntent: response.intent, preferredModel, lastModelUsed: actualModel, updatedAt: now() } : current)
        void Promise.all([
          persistHamletMessage(conversationId, assistantMessage, actualModel),
          persistHamletState(conversationId, { intent: response.intent, preferredModel, lastModelUsed: actualModel }),
        ]).catch((reason) => setPersistenceWarning(reason instanceof Error ? reason.message : 'Hamlet response could not be persisted.'))
        const generated = response.conversationMetadata
        const source = activeConversation?.titleSource ?? conversation?.titleSource ?? 'pending'
        if (generated?.ready && generated.title && generated.description && source !== 'user') {
          void applyHamletAiMetadata(conversationId, generated.title, generated.description).then(() => {
            setConversation((current) => current ? { ...current, title: generated.title!, description: generated.description!, titleSource: 'ai' } : current)
          }).catch((reason) => setPersistenceWarning(reason instanceof Error ? reason.message : 'AI title could not be persisted.'))
        }
      }
      await runSearch(response.intent, conversationId)
    } catch (reason) {
      const messageText = reason instanceof Error ? reason.message : 'Hamlet is temporarily unavailable. Please try again.'
      setError(messageText)
      const failure = makeMessage('assistant', messageText)
      setMessages((current) => [...current, failure])
      const conversationId = activeConversation?.id ?? conversation?.id
      if (conversationId) void persistHamletMessage(conversationId, failure).catch(() => undefined)
    } finally { setThinking(false) }
  }

  async function removeChip(kind: 'genres'|'themes'|'concepts'|'avoidGenres'|'avoidConcepts', value: string) {
    const next = { ...intent, [kind]: intent[kind].filter((item) => item !== value) } as HamletSearchIntent
    setIntent(next); setError('')
    if (conversation) void persistHamletState(conversation.id, { intent: next }).catch(() => undefined)
    await runSearch(next, conversation?.id)
  }

  async function toggleExcludeWatched() {
    const next = { ...intent, excludeWatched: !intent.excludeWatched }
    setIntent(next)
    if (conversation) void persistHamletState(conversation.id, { intent: next }).catch(() => undefined)
    await runSearch(next, conversation?.id)
  }

  async function chooseWatchAction(action: HamletCatalogAction) {
    if (watchIndex == null) return
    const row = recommendations[watchIndex]
    if (!row) return
    setWatchBusy(true); setError('')
    try {
      await applyHamletCatalogAction(row.anime, action)
      const next = recommendations.map((item, index) => index === watchIndex ? { ...item, watched: action === 'watched', catalogAction: action } : item)
      setRecommendations(action === 'watched' && intent.excludeWatched ? next.filter((_, index) => index !== watchIndex) : next)
      if (conversation) void recordHamletRecommendationAction(conversation.id, row.anime.malId, action).catch(() => undefined)
      setWatchIndex(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update your Personal Catalog.') }
    finally { setWatchBusy(false) }
  }

  async function newConversation() {
    try { await archiveHamletConversation(conversation?.id ?? null) }
    catch (reason) { setPersistenceWarning(reason instanceof Error ? reason.message : 'Previous conversation remains available but could not be archived cleanly.') }
    setConversation(null); setMessages([intro()]); setIntent(emptyHamletIntent); setRecommendations([]); setDraft(''); setError(''); setLastSuccessfulModel(null); setFallbackUsed(false); setPreferredModel(DEFAULT_HAMLET_GEMINI_MODEL)
  }

  async function continueLastConversation() {
    try {
      const latest = await loadLatestHamletConversation()
      if (!latest) { setPersistenceWarning('No previous Hamlet conversation exists yet.'); return }
      if (latest.id === conversation?.id) return
      await restoreConversation(latest.id, true)
    } catch (reason) { setPersistenceWarning(reason instanceof Error ? reason.message : 'Could not continue the latest conversation.') }
  }

  function selectPreferredModel(model: string) {
    setPreferredModel(model); setLastSuccessfulModel(null); setFallbackUsed(false)
    if (conversation) {
      setConversation((current) => current ? { ...current, preferredModel: model } : current)
      void persistHamletState(conversation.id, { preferredModel: model }).catch((reason) => setPersistenceWarning(reason instanceof Error ? reason.message : 'Preferred model could not be persisted.'))
    }
  }

  return <section className="hamlet-workspace" aria-label="Hamlet AI conversational anime discovery">
    <header className="hamlet-header">
      <div><span className="eyebrow">✨ HAMLET AI</span><h2>Conversational Anime Discovery</h2><p>Describe what you want. Hamlet interprets the request; AnimeFinder finds the real catalog results.</p>{conversation && <div className="hamlet-active-conversation"><strong>{conversation.title}</strong>{conversation.description && <span>{conversation.description}</span>}</div>}</div>
      <div className="hamlet-header-actions">
        <div className="hamlet-conversation-actions"><button className="ghost-button" onClick={() => void newConversation()}>New Conversation</button><button className="ghost-button" onClick={() => setHistoryOpen(true)}>Conversation History</button><button className="ghost-button" onClick={() => void continueLastConversation()}>Continue Last Conversation</button></div>
        <HamletModelSelector displayedModel={displayedModel} preferredModel={preferredModel} fallbackUsed={fallbackUsed} onSelect={selectPreferredModel} />
      </div>
    </header>
    {persistenceWarning && <div className="hamlet-persistence-warning">⚠ {persistenceWarning}</div>}
    <div className="hamlet-intent-bar"><span className="hamlet-intent-label">Hamlet understood</span><div className="hamlet-chip-row">{chips.map((chip) => <button key={`${chip.kind}-${chip.value}`} className={`hamlet-chip ${chip.kind.startsWith('avoid') ? 'avoid' : ''}`} onClick={() => void removeChip(chip.kind, chip.value)}>{chip.label} <b>×</b></button>)}<button className={`hamlet-chip ${intent.excludeWatched ? 'active' : ''}`} onClick={() => void toggleExcludeWatched()}>{intent.excludeWatched ? 'Not Watched ×' : 'Include Watched +'}</button>{!chips.length && <span className="hamlet-empty-chip">No criteria yet</span>}</div></div>
    <div className="hamlet-columns">
      <section className="hamlet-conversation-panel">
        <div className="hamlet-panel-heading"><span className="eyebrow">CONVERSATION</span><strong>Talk to Hamlet</strong></div>
        <div className="hamlet-messages">{restoring && <div className="hamlet-message assistant thinking"><span>Hamlet</span><p>Restoring conversation…</p></div>}{messages.map((message) => <div key={message.id} className={`hamlet-message ${message.role}`}><span>{message.role === 'assistant' ? 'Hamlet' : 'You'}</span><p>{message.content}</p>{message.role === 'assistant' && message.modelUsed && <small>{hamletModelLabel(message.modelUsed)}</small>}</div>)}{thinking && <div className="hamlet-message assistant thinking"><span>Hamlet</span><p>Hamlet is thinking<span className="hamlet-dots">...</span></p></div>}</div>
        {error && <div className="notice error hamlet-error">{error} Traditional Search remains available.</div>}
        <form className="hamlet-composer" onSubmit={(event) => void send(event)}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder="Quero assistir um anime sobre RPG…" rows={2} aria-label="Message Hamlet"/><button className="primary-button" type="submit" disabled={!draft.trim() || thinking}>➤</button></form>
      </section>
      <section className="hamlet-recommendations-panel">
        <div className="hamlet-panel-heading"><span className="eyebrow">RECOMMENDATIONS</span><strong>{intent.readyToSearch ? 'Real AnimeFinder results' : 'Waiting for enough criteria'}</strong></div>
        {intent.clarificationQuestion && !intent.readyToSearch && <div className="hamlet-clarification">{intent.clarificationQuestion}</div>}
        {searching ? <div className="hamlet-loading"><span className="spinner"/><strong>Searching AnimeFinder…</strong></div> : recommendations.length ? <div className="hamlet-results-grid">{recommendations.map((recommendation, index) => <HamletAnimeCard key={recommendation.anime.malId} recommendation={recommendation} onMarkWatched={() => setWatchIndex(index)}/>)}</div> : <div className="hamlet-empty-results"><span>✨</span><strong>{intent.readyToSearch ? 'No matching catalog results yet' : 'Your recommendations will appear here'}</strong><p>{intent.readyToSearch ? 'Remove a criterion or tell Hamlet how to broaden the search.' : 'Hamlet will ask a short clarification when your request is ambiguous.'}</p></div>}
      </section>
    </div>
    <HamletConversationHistory open={historyOpen} onClose={() => setHistoryOpen(false)} onOpenConversation={(id) => void restoreConversation(id, true)}/>
    {watchIndex != null && recommendations[watchIndex] && <WatchedChoiceDialog title={recommendations[watchIndex].anime.title} busy={watchBusy} onChoose={(action) => void chooseWatchAction(action)} onClose={() => setWatchIndex(null)}/>} 
  </section>
}
