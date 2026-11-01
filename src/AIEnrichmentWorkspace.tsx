import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AnimeCharacterCredit } from './types'
import type { ManagedCatalogWork } from './personalCatalogManager'
import { animeProvider } from './providers'
import { listAnimeComments, saveAnimeComment, type AnimeComment } from './comments'
import {
  consolidateComment,
  loadEnrichment,
  saveEnrichment,
  suggestEnrichment,
  type CharacterSentiment,
  type EnrichmentCharacter,
  type EnrichmentKeyword,
  type PersonalAnimeProfile,
} from './aiEnrichment'

type WorkspaceTab = 'conversation' | 'profile'
type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: any) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function recognitionCtor(): SpeechRecognitionCtor | null {
  const win = window as typeof window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function textToHtml(value: string) {
  return value.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph.trim())}</p>`).join('')
}

function KeywordList({ keywords, onChange }: { keywords: EnrichmentKeyword[]; onChange: (keywords: EnrichmentKeyword[]) => void }) {
  const dragIndex = useRef<number | null>(null)
  const [manual, setManual] = useState('')

  function reorder(target: number) {
    if (dragIndex.current == null || dragIndex.current === target) return
    const next = [...keywords]
    const [moved] = next.splice(dragIndex.current, 1)
    next.splice(target, 0, moved)
    onChange(next.map((item, index) => ({ ...item, importance: index + 1 })))
    dragIndex.current = null
  }

  function addManual() {
    const name = manual.trim()
    if (!name || keywords.some((keyword) => keyword.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return
    onChange([...keywords, { name, importance: keywords.length + 1, confirmed: true, source: 'manual' }])
    setManual('')
  }

  return <div className="ai-enrich-keywords">
    {keywords.length === 0 && <div className="ai-enrich-empty">No keywords yet.</div>}
    {keywords.map((keyword, index) => <div key={`${keyword.name}-${index}`} className={keyword.confirmed ? 'ai-keyword-row confirmed' : 'ai-keyword-row suggested'} draggable onDragStart={() => { dragIndex.current = index }} onDragOver={(event) => event.preventDefault()} onDrop={() => reorder(index)}>
      <span className="ai-drag-handle">≡</span>
      <b>{index + 1}. {keyword.name}</b>
      <small>{keyword.source === 'manual' ? 'Manual' : keyword.confirmed ? 'Confirmed' : 'Suggestion'}</small>
      <button type="button" onClick={() => onChange(keywords.map((item, i) => i === index ? { ...item, confirmed: !item.confirmed } : item))}>{keyword.confirmed ? '✓' : 'Confirm'}</button>
      <button type="button" aria-label={`Remove ${keyword.name}`} onClick={() => onChange(keywords.filter((_, i) => i !== index).map((item, i) => ({ ...item, importance: i + 1 })))}>×</button>
    </div>)}
    <div className="ai-inline-add"><input value={manual} onChange={(event) => setManual(event.target.value)} placeholder="Add keyword manually" onKeyDown={(event) => { if (event.key === 'Enter') addManual() }} /><button type="button" onClick={addManual}>+ Add</button></div>
  </div>
}

function CharacterList({ characters, onChange, candidates, candidateQuery, onCandidateQuery, loadingCandidates, onLoadCandidates }: {
  characters: EnrichmentCharacter[]
  onChange: (characters: EnrichmentCharacter[]) => void
  candidates: AnimeCharacterCredit[]
  candidateQuery: string
  onCandidateQuery: (value: string) => void
  loadingCandidates: boolean
  onLoadCandidates: () => void
}) {
  const filtered = useMemo(() => {
    const term = candidateQuery.trim().toLocaleLowerCase()
    if (!term) return []
    return candidates.filter((candidate) => candidate.character.name.toLocaleLowerCase().includes(term)).slice(0, 8)
  }, [candidates, candidateQuery])

  function addCandidate(candidate: AnimeCharacterCredit) {
    if (characters.some((item) => item.characterId === candidate.character.malId)) return
    onChange([...characters, {
      characterId: candidate.character.malId,
      name: candidate.character.name,
      imageUrl: candidate.character.imageUrl ?? null,
      role: candidate.role ?? null,
      sentiment: 'interesting',
      reason: '',
      confirmed: true,
      source: 'manual',
    }])
    onCandidateQuery('')
  }

  return <div className="ai-enrich-characters">
    {characters.length === 0 && <div className="ai-enrich-empty">No highlighted characters yet.</div>}
    {characters.map((character, index) => <article className={character.confirmed ? 'ai-character-card confirmed' : 'ai-character-card suggested'} key={`${character.characterId ?? character.name}-${index}`}>
      <div className="ai-character-main">
        {character.imageUrl ? <img src={character.imageUrl} alt="" loading="lazy" /> : <span className="ai-character-placeholder">{character.name.slice(0, 1)}</span>}
        <div><strong>{character.name}</strong><small>{character.role || 'Character'} · {character.confirmed ? 'Confirmed' : 'Suggestion'}</small></div>
        <button type="button" onClick={() => onChange(characters.filter((_, i) => i !== index))}>×</button>
      </div>
      <div className="ai-character-fields">
        <label><span>Relation</span><select value={character.sentiment} onChange={(event) => onChange(characters.map((item, i) => i === index ? { ...item, sentiment: event.target.value as CharacterSentiment } : item))}><option value="favorite">Favorite</option><option value="liked">Liked</option><option value="interesting">Interesting</option><option value="memorable">Memorable</option><option value="disliked">Disliked</option></select></label>
        <label><span>Why it stood out</span><textarea value={character.reason} onChange={(event) => onChange(characters.map((item, i) => i === index ? { ...item, reason: event.target.value } : item))} placeholder="Optional personal reason" /></label>
      </div>
      {!character.confirmed && <button className="ghost-button compact" type="button" onClick={() => onChange(characters.map((item, i) => i === index ? { ...item, confirmed: true } : item))}>Confirm character</button>}
    </article>)}

    <div className="ai-character-search">
      {candidates.length === 0 ? <button className="ghost-button" type="button" disabled={loadingCandidates} onClick={onLoadCandidates}>{loadingCandidates ? 'Loading characters…' : '+ Add character'}</button> : <><input value={candidateQuery} onChange={(event) => onCandidateQuery(event.target.value)} placeholder="Search characters from this anime…" />{filtered.length > 0 && <div className="ai-character-results">{filtered.map((candidate) => <button type="button" key={candidate.character.malId} onClick={() => addCandidate(candidate)}>{candidate.character.imageUrl ? <img src={candidate.character.imageUrl} alt="" /> : <span /> }<div><strong>{candidate.character.name}</strong><small>{candidate.role || 'Character'}</small></div></button>)}</div>}</>}
    </div>
  </div>
}

export default function AIEnrichmentWorkspace({ work, onClose, onSaved }: { work: ManagedCatalogWork; onClose: () => void; onSaved: (profile: PersonalAnimeProfile, comment: AnimeComment | null) => void }) {
  const [tab, setTab] = useState<WorkspaceTab>('conversation')
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<PersonalAnimeProfile | null>(null)
  const [existingComment, setExistingComment] = useState<AnimeComment | null>(null)
  const [draftComment, setDraftComment] = useState('')
  const [transcript, setTranscript] = useState('')
  const [suggestedComment, setSuggestedComment] = useState('')
  const [keywords, setKeywords] = useState<EnrichmentKeyword[]>([])
  const [characters, setCharacters] = useState<EnrichmentCharacter[]>([])
  const [candidateCharacters, setCandidateCharacters] = useState<AnimeCharacterCredit[]>([])
  const [candidateQuery, setCandidateQuery] = useState('')
  const [loadingCharacters, setLoadingCharacters] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisMode, setAnalysisMode] = useState<'remote-ai' | 'local-assist' | null>(null)
  const [recording, setRecording] = useState(false)
  const [speechUnavailable, setSpeechUnavailable] = useState(false)
  const [showFullComment, setShowFullComment] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  useEffect(() => {
    let live = true
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    void Promise.all([
      loadEnrichment(work.id, work.primaryMalId),
      listAnimeComments(),
    ]).then(([saved, comments]) => {
      if (!live) return
      const comment = work.primaryMalId ? comments.find((row) => row.malId === work.primaryMalId) ?? null : null
      setProfile(saved)
      setExistingComment(comment)
      const initial = saved.comment || comment?.contentText || ''
      setDraftComment(initial)
      setKeywords(saved.keywords)
      setCharacters(saved.characters)
    }).finally(() => { if (live) setLoading(false) })
    return () => {
      live = false
      recognitionRef.current?.stop()
      document.body.style.overflow = previousOverflow
    }
  }, [work.id, work.primaryMalId])

  function startSpeech() {
    const Ctor = recognitionCtor()
    if (!Ctor) { setSpeechUnavailable(true); return }
    const recognition = new Ctor()
    recognition.lang = 'pt-BR'
    recognition.continuous = true
    recognition.interimResults = false
    recognition.onresult = (event) => {
      let text = ''
      for (let index = event.resultIndex ?? 0; index < event.results.length; index += 1) text += `${event.results[index][0].transcript} `
      setTranscript((current) => `${current} ${text}`.trim())
    }
    recognition.onerror = () => setRecording(false)
    recognition.onend = () => setRecording(false)
    recognitionRef.current = recognition
    recognition.start()
    setRecording(true)
    setSpeechUnavailable(false)
  }

  function stopSpeech() {
    recognitionRef.current?.stop()
    setRecording(false)
  }

  function useTranscript() {
    const next = consolidateComment(draftComment, transcript)
    setSuggestedComment(next)
    setTranscript('')
  }

  async function loadCharacters() {
    if (!work.primaryMalId || loadingCharacters) return
    setLoadingCharacters(true)
    try { setCandidateCharacters(await animeProvider.getAnimeCharacters(work.primaryMalId)) } catch { setStatus('Character metadata is unavailable right now.') }
    finally { setLoadingCharacters(false) }
  }

  async function analyze() {
    const sourceComment = (suggestedComment || draftComment).trim()
    if (!sourceComment) { setStatus('Add a comment first.'); return }
    setAnalyzing(true)
    setStatus('Organizing only what you actually expressed…')
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 8000)
    try {
      let candidates = candidateCharacters
      if (work.primaryMalId && candidates.length === 0) {
        try { candidates = await Promise.race([animeProvider.getAnimeCharacters(work.primaryMalId), new Promise<AnimeCharacterCredit[]>((resolve) => window.setTimeout(() => resolve([]), 1800))]); if (candidates.length) setCandidateCharacters(candidates) } catch { candidates = [] }
      }
      const anime = work.primaryMalId ? await Promise.race([personalMetadata(work.primaryMalId), new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1200))]) : null
      const result = await suggestEnrichment({ work, anime, comment: sourceComment, originalObservations: work.originalObservations, characterCandidates: candidates, signal: controller.signal })
      setSuggestedComment(result.suggestedComment || sourceComment)
      setKeywords(result.keywords)
      setCharacters(result.characters)
      setAnalysisMode(result.mode)
      setStatus(result.mode === 'remote-ai' ? 'AI suggestions ready. Nothing becomes definitive until you confirm it.' : 'Structured suggestions ready. Remote AI is not configured, so AnimeFinder used the local assist layer.')
      setTab('profile')
    } catch {
      setStatus('Could not analyze the comment right now. Your draft was preserved.')
    } finally {
      window.clearTimeout(timer)
      setAnalyzing(false)
    }
  }

  async function save() {
    if (!profile) return
    const approvedComment = (suggestedComment || draftComment).trim()
    setSaving(true)
    setStatus('Saving enrichment…')
    try {
      let savedComment: AnimeComment | null = existingComment
      if (work.primaryMalId && approvedComment) savedComment = await saveAnimeComment(work.primaryMalId, textToHtml(approvedComment), approvedComment)
      const savedProfile = await saveEnrichment({
        personalWorkId: work.id,
        malId: work.primaryMalId,
        comment: approvedComment,
        aiEnriched: true,
        lastEnrichedAt: new Date().toISOString(),
        keywords: keywords.filter((keyword) => keyword.confirmed),
        characters: characters.filter((character) => character.confirmed),
      })
      setStatus(savedProfile.storage === 'supabase' ? '✓ Enrichment saved to Supabase.' : '✓ Enrichment saved locally. Run the AI enrichment migration to sync across devices.')
      onSaved(savedProfile, savedComment)
      window.setTimeout(onClose, 650)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save enrichment.')
    } finally { setSaving(false) }
  }

  const currentComment = (suggestedComment || draftComment).trim()

  if (loading || !profile) return createPortal(<div className="ai-enrichment-backdrop"><div className="ai-enrichment-loading"><span className="spinner" /><strong>Opening personal knowledge workspace…</strong></div></div>, document.body)

  return createPortal(<div className="ai-enrichment-backdrop">
    <section className="ai-enrichment-workspace" role="dialog" aria-modal="true" aria-label={`Enrich ${work.displayName} with AI`}>
      <header className="ai-enrichment-header"><div><span className="eyebrow">AI-ASSISTED PERSONAL KNOWLEDGE</span><h1>{work.displayName}</h1></div><div><span className="ai-enrichment-title">✨ Enriquecer com IA</span><button type="button" onClick={onClose} aria-label="Close">×</button></div></header>
      <div className="ai-mobile-tabs"><button className={tab === 'conversation' ? 'active' : ''} onClick={() => setTab('conversation')}>Conversa</button><button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>Perfil</button></div>
      <div className="ai-enrichment-body">
        <aside className={tab === 'conversation' ? 'ai-conversation active' : 'ai-conversation'}>
          <div className="ai-guide-message"><span>ASSISTENTE</span>{existingComment?.contentText || profile.comment ? <p>Este é seu comentário atual sobre a obra. Você pode complementar por voz ou texto, e depois eu organizo sugestões sem transformar inferências em preferências definitivas.</p> : <p>Você ainda não escreveu um comentário sobre esta obra. Faça um comentário inicial sobre o que você achou dela.</p>}</div>
          {existingComment?.contentText && <div className="ai-current-comment"><span>COMENTÁRIO ATUAL</span><p>{existingComment.contentText}</p></div>}
          <label className="ai-comment-input"><span>{existingComment?.contentText ? 'Complemento / comentário de trabalho' : 'Seu comentário'}</span><textarea value={draftComment} onChange={(event) => setDraftComment(event.target.value)} placeholder="Escreva apenas o que você realmente pensa sobre esta obra…" /></label>
          <div className="ai-speech-box"><div><strong>🎙️ Falar</strong><small>Português (Brasil) · transcrição local do navegador</small></div><button className={recording ? 'primary-button recording' : 'ghost-button'} type="button" onClick={recording ? stopSpeech : startSpeech}>{recording ? '■ Parar' : '🎙️ Gravar comentário'}</button></div>
          {speechUnavailable && <div className="notice error">Seu navegador não disponibiliza reconhecimento de voz nesta sessão. Você ainda pode escrever normalmente.</div>}
          {transcript && <div className="ai-transcript"><span>NOVA TRANSCRIÇÃO</span><p>{transcript}</p><button className="ghost-button" type="button" onClick={useTranscript}>Combinar com comentário</button></div>}
          {suggestedComment && suggestedComment !== draftComment && <div className="ai-suggested-comment"><span>COMENTÁRIO CONSOLIDADO SUGERIDO</span><textarea value={suggestedComment} onChange={(event) => setSuggestedComment(event.target.value)} /><div><button className="primary-button" type="button" onClick={() => setDraftComment(suggestedComment)}>Usar esta versão</button><button className="text-button" type="button" onClick={() => setSuggestedComment('')}>Manter comentário anterior</button></div></div>}
          <button className="primary-button ai-analyze-button" type="button" disabled={analyzing || !currentComment} onClick={analyze}>{analyzing ? 'Analisando…' : '✨ Organizar e sugerir'}</button>
          <small className="ai-privacy-note">A análise recebe somente esta obra, seu comentário, a observação histórica quando relevante e metadados mínimos — nunca o catálogo inteiro.</small>
          {status && <div className="ai-workspace-status">{status}</div>}
        </aside>

        <main className={tab === 'profile' ? 'ai-profile-panel active' : 'ai-profile-panel'}>
          <article className="ai-profile-card"><div className="ai-profile-card-title"><div><span>COMENTÁRIO</span><strong>Comentário consolidado</strong></div>{analysisMode && <small>{analysisMode === 'remote-ai' ? 'Remote AI' : 'Local assist'}</small>}</div>{currentComment ? <p className={showFullComment ? 'expanded' : ''}>{currentComment}</p> : <div className="ai-enrich-empty">No comment yet.</div>}{currentComment.length > 260 && <button className="text-button" type="button" onClick={() => setShowFullComment((value) => !value)}>{showFullComment ? 'Recolher' : 'Ver completo'}</button>}</article>
          <article className="ai-profile-card"><div className="ai-profile-card-title"><div><span>KEYWORDS</span><strong>O que chamou sua atenção</strong></div><small>{keywords.filter((keyword) => keyword.confirmed).length} confirmed</small></div><p className="ai-card-help">Suggestions only become profile evidence after you confirm them. Drag to rank importance.</p><KeywordList keywords={keywords} onChange={setKeywords} /></article>
          <article className="ai-profile-card"><div className="ai-profile-card-title"><div><span>PERSONAGENS DESTACADOS</span><strong>Characters that mattered to you</strong></div><small>{characters.filter((character) => character.confirmed).length} confirmed</small></div><p className="ai-card-help">Mentioning a character does not mean “favorite”. Choose the relation yourself.</p><CharacterList characters={characters} onChange={setCharacters} candidates={candidateCharacters} candidateQuery={candidateQuery} onCandidateQuery={setCandidateQuery} loadingCandidates={loadingCharacters} onLoadCandidates={loadCharacters} /></article>
        </main>
      </div>
      <footer className="ai-enrichment-footer"><button className="text-button" type="button" onClick={onClose}>Cancelar</button><button className="primary-button" type="button" disabled={saving} onClick={save}>{saving ? 'Salvando…' : 'Salvar enriquecimento'}</button></footer>
    </section>
  </div>, document.body)
}

async function personalMetadata(malId: number) {
  try { return await animeProvider.getAnime(malId) } catch { return null }
}
