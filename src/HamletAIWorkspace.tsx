import { FormEvent, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { hamletAIProvider } from './GeminiProvider'
import { removeWatched, saveWatched, watchedFromAnime } from './catalog'
import { searchHamletAnime } from './hamletSearchService'
import { DEFAULT_HAMLET_GEMINI_MODEL, HAMLET_GEMINI_MODELS, HAMLET_PROVIDER_OPTIONS, hamletModelLabel } from './hamletModels'
import { emptyHamletIntent, type HamletMessage, type HamletRecommendation, type HamletSearchIntent } from './hamletTypes'

const now = () => new Date().toISOString()
const makeMessage = (role: HamletMessage['role'], content: string): HamletMessage => ({ id: crypto.randomUUID(), role, content, createdAt: now() })
const intro = () => makeMessage('assistant', 'Tell me what you feel like watching. I can clarify anime concepts and turn your answers into real AnimeFinder search criteria.')

function HamletAnimeCard({ recommendation, onToggleWatched }: { recommendation: HamletRecommendation; onToggleWatched: () => void }) {
  const navigate = useNavigate()
  const { anime } = recommendation
  const altTitle = anime.titleEnglish && anime.titleEnglish !== anime.title ? anime.titleEnglish : anime.titleJapanese
  return <div className="hamlet-result-wrap">
    <article className="anime-card hamlet-anime-card">
      <button className="poster-button" onClick={() => navigate(`/app/anime/${anime.malId}`)} aria-label={`Open ${anime.title}`}>
        {anime.imageUrl ? <img src={anime.imageUrl} alt={anime.title} loading="lazy" /> : <div className="poster-placeholder">No image</div>}
        <span className="score-badge">★ {anime.score?.toFixed(1) ?? '—'}</span>
      </button>
      <div className="anime-card-body">
        <div className="card-meta"><span>{anime.type ?? 'Anime'}</span><span>{anime.year ?? '—'}</span><span>{anime.episodes ? `${anime.episodes} ep` : 'Episodes —'}</span></div>
        <button className="title-button" onClick={() => navigate(`/app/anime/${anime.malId}`)}>{anime.title}</button>
        {altTitle && <div className="alt-title">{altTitle}</div>}
        <div className="genre-row">{anime.genres.slice(0, 3).map((genre) => <span key={genre.id}>{genre.name}</span>)}</div>
        <div className="card-footer"><span className={`status-dot ${anime.status === 'Currently Airing' ? 'live' : ''}`}>{anime.status ?? 'Unknown'}</span><button className={recommendation.watched ? 'watched-button active' : 'watched-button'} onClick={onToggleWatched}>{recommendation.watched ? '✓ Watched' : '+ Watched'}</button></div>
      </div>
    </article>
    <div className="hamlet-why"><strong>Why it matches</strong><span>{recommendation.whyMatches}</span></div>
  </div>
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

function HamletModelSelector({
  displayedModel,
  preferredModel,
  fallbackUsed,
  onSelect,
}: {
  displayedModel: string
  preferredModel: string
  fallbackUsed: boolean
  onSelect: (model: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'providers' | 'gemini'>('providers')

  function close() { setOpen(false); setView('providers') }

  return <div className="hamlet-model-control">
    <span className="hamlet-model-label">Model</span>
    <button className="hamlet-model-button" onClick={() => { setOpen((value) => !value); setView('providers') }} aria-expanded={open}>
      <span>{hamletModelLabel(displayedModel)}</span><b>⌄</b>
    </button>
    {fallbackUsed && <small className="hamlet-fallback-note" title="Fallback model — preferred model temporarily unavailable.">Fallback model</small>}
    {displayedModel !== preferredModel && <small className="hamlet-preferred-note">Preferred: {hamletModelLabel(preferredModel)}</small>}
    {open && <div className="hamlet-model-popover" role="dialog" aria-label="Hamlet model selector">
      {view === 'providers' ? <>
        <div className="hamlet-model-popover-title">AI Provider</div>
        {HAMLET_PROVIDER_OPTIONS.map((provider) => provider.available
          ? <button key={provider.id} className="hamlet-provider-option available" onClick={() => setView('gemini')}><span>{provider.label}</span><small>Available</small><b>›</b></button>
          : <div key={provider.id} className="hamlet-provider-disabled" data-tooltip="Provider not available yet."><button className="hamlet-provider-option" disabled><span>{provider.label}</span><small>Unavailable</small></button></div>)}
      </> : <>
        <button className="hamlet-model-back" onClick={() => setView('providers')}>← Providers</button>
        <div className="hamlet-model-popover-title">Gemini models</div>
        {HAMLET_GEMINI_MODELS.map((model) => <button key={model.id} className={`hamlet-model-option ${preferredModel === model.id ? 'preferred' : ''}`} onClick={() => { onSelect(model.id); close() }}>
          <span>{model.label}</span>
          <small>{preferredModel === model.id ? 'Preferred' : 'Use as preferred'}</small>
        </button>)}
      </>}
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
  const [error, setError] = useState('')
  const [preferredModel, setPreferredModel] = useState(DEFAULT_HAMLET_GEMINI_MODEL)
  const [lastSuccessfulModel, setLastSuccessfulModel] = useState<string | null>(null)
  const [fallbackUsed, setFallbackUsed] = useState(false)
  const chips = useMemo(() => intentChips(intent), [intent])
  const displayedModel = lastSuccessfulModel ?? preferredModel

  async function runSearch(nextIntent: HamletSearchIntent) {
    if (!nextIntent.readyToSearch) { setRecommendations([]); return }
    setSearching(true)
    try { setRecommendations(await searchHamletAnime(nextIntent)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not search the anime catalog right now.') }
    finally { setSearching(false) }
  }

  async function send(event?: FormEvent) {
    event?.preventDefault()
    const message = draft.trim()
    if (!message || thinking) return
    const userMessage = makeMessage('user', message)
    const conversation = [...messages, userMessage]
    setMessages(conversation); setDraft(''); setThinking(true); setError('')
    try {
      const response = await hamletAIProvider.sendMessage({
        message,
        conversation: messages.map(({ role, content }) => ({ role, content })),
        currentIntent: intent,
        preferredModel,
      })
      setMessages((current) => [...current, makeMessage('assistant', response.reply)])
      setIntent(response.intent)
      const actualModel = response.model ?? preferredModel
      setLastSuccessfulModel(actualModel)
      setFallbackUsed(response.fallbackUsed === true || actualModel !== preferredModel)
      await runSearch(response.intent)
    } catch (reason) {
      const messageText = reason instanceof Error ? reason.message : 'Hamlet is temporarily unavailable. Please try again.'
      setError(messageText)
      setMessages((current) => [...current, makeMessage('assistant', messageText)])
    } finally { setThinking(false) }
  }

  async function removeChip(kind: 'genres'|'themes'|'concepts'|'avoidGenres'|'avoidConcepts', value: string) {
    const next = { ...intent, [kind]: intent[kind].filter((item) => item !== value) } as HamletSearchIntent
    setIntent(next); setError(''); await runSearch(next)
  }

  async function toggleExcludeWatched() {
    const next = { ...intent, excludeWatched: !intent.excludeWatched }
    setIntent(next); await runSearch(next)
  }

  async function toggleWatched(index: number) {
    const row = recommendations[index]
    if (!row) return
    try {
      if (row.watched) await removeWatched(row.anime.malId)
      else await saveWatched(watchedFromAnime(row.anime))
      setRecommendations((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, watched: !item.watched } : item))
      if (intent.excludeWatched && !row.watched) setRecommendations((current) => current.filter((_, itemIndex) => itemIndex !== index))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update your catalog.') }
  }

  function clearConversation() {
    setMessages([intro()]); setIntent(emptyHamletIntent); setRecommendations([]); setDraft(''); setError(''); setLastSuccessfulModel(null); setFallbackUsed(false)
  }

  function selectPreferredModel(model: string) {
    setPreferredModel(model)
    setLastSuccessfulModel(null)
    setFallbackUsed(false)
  }

  return <section className="hamlet-workspace" aria-label="Hamlet AI conversational anime discovery">
    <header className="hamlet-header">
      <div><span className="eyebrow">✨ HAMLET AI</span><h2>Conversational Anime Discovery</h2><p>Describe what you want. Hamlet interprets the request; AnimeFinder finds the real catalog results.</p></div>
      <div className="hamlet-header-actions">
        <button className="ghost-button" onClick={clearConversation}>Clear Conversation</button>
        <HamletModelSelector displayedModel={displayedModel} preferredModel={preferredModel} fallbackUsed={fallbackUsed} onSelect={selectPreferredModel} />
      </div>
    </header>
    <div className="hamlet-intent-bar">
      <span className="hamlet-intent-label">Hamlet understood</span>
      <div className="hamlet-chip-row">
        {chips.map((chip) => <button key={`${chip.kind}-${chip.value}`} className={`hamlet-chip ${chip.kind.startsWith('avoid') ? 'avoid' : ''}`} onClick={() => void removeChip(chip.kind, chip.value)}>{chip.label} <b>×</b></button>)}
        <button className={`hamlet-chip ${intent.excludeWatched ? 'active' : ''}`} onClick={() => void toggleExcludeWatched()}>{intent.excludeWatched ? 'Not Watched ×' : 'Include Watched +'}</button>
        {!chips.length && <span className="hamlet-empty-chip">No criteria yet</span>}
      </div>
    </div>
    <div className="hamlet-columns">
      <section className="hamlet-conversation-panel">
        <div className="hamlet-panel-heading"><span className="eyebrow">CONVERSATION</span><strong>Talk to Hamlet</strong></div>
        <div className="hamlet-messages">
          {messages.map((message) => <div key={message.id} className={`hamlet-message ${message.role}`}><span>{message.role === 'assistant' ? 'Hamlet' : 'You'}</span><p>{message.content}</p></div>)}
          {thinking && <div className="hamlet-message assistant thinking"><span>Hamlet</span><p>Hamlet is thinking<span className="hamlet-dots">...</span></p></div>}
        </div>
        {error && <div className="notice error hamlet-error">{error} Traditional Search remains available.</div>}
        <form className="hamlet-composer" onSubmit={(event) => void send(event)}>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder="Quero assistir um anime sobre RPG…" rows={2} aria-label="Message Hamlet" />
          <button className="primary-button" type="submit" disabled={!draft.trim() || thinking}>➤</button>
        </form>
      </section>
      <section className="hamlet-recommendations-panel">
        <div className="hamlet-panel-heading"><span className="eyebrow">RECOMMENDATIONS</span><strong>{intent.readyToSearch ? 'Real AnimeFinder results' : 'Waiting for enough criteria'}</strong></div>
        {intent.clarificationQuestion && !intent.readyToSearch && <div className="hamlet-clarification">{intent.clarificationQuestion}</div>}
        {searching ? <div className="hamlet-loading"><span className="spinner"/><strong>Searching AnimeFinder…</strong></div> : recommendations.length ? <div className="hamlet-results-grid">{recommendations.map((recommendation, index) => <HamletAnimeCard key={recommendation.anime.malId} recommendation={recommendation} onToggleWatched={() => void toggleWatched(index)} />)}</div> : <div className="hamlet-empty-results"><span>✨</span><strong>{intent.readyToSearch ? 'No matching catalog results yet' : 'Your recommendations will appear here'}</strong><p>{intent.readyToSearch ? 'Remove a criterion or tell Hamlet how to broaden the search.' : 'Hamlet will ask a short clarification when your request is ambiguous.'}</p></div>}
      </section>
    </div>
  </section>
}
