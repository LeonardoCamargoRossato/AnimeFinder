import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ManagedCatalogWork } from './personalCatalogManager'
import { listAnimeComments, saveAnimeComment, type AnimeComment } from './comments'
import {
  AIService,
  appendCharacterVersion,
  appendWorkVersion,
  clearDraft,
  currentWorkVersion,
  loadPersonalKnowledge,
  readDraft,
  savePersonalKnowledge,
  writeDraft,
  type CharacterKnowledge,
  type CommentVersion,
  type KnowledgeKeyword,
  type PersonalKnowledge,
  type VersionSource,
} from './aiPersonalKnowledge'

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

function mergeKeywords(existing: KnowledgeKeyword[], suggested: KnowledgeKeyword[]) {
  const confirmed = existing.filter((row) => row.confirmed)
  const seen = new Set(confirmed.map((row) => row.label.toLocaleLowerCase()))
  return [...confirmed, ...suggested.filter((row) => !seen.has(row.label.toLocaleLowerCase()))]
    .map((row, index) => ({ ...row, rank: index + 1 }))
}

function mergeCharacters(existing: CharacterKnowledge[], suggested: CharacterKnowledge[]) {
  const rows = existing.map((row, index) => ({ ...row, rank: row.rank || index + 1 }))
  for (const suggestion of suggested) {
    const match = rows.find((row) => row.name.toLocaleLowerCase() === suggestion.name.toLocaleLowerCase())
    if (!match) rows.push({ ...suggestion, rank: rows.length + 1 })
  }
  return rows.map((row, index) => ({ ...row, rank: index + 1 }))
}

function KeywordEditor({ keywords, onChange, onSave, saving }: { keywords: KnowledgeKeyword[]; onChange: (rows: KnowledgeKeyword[]) => void; onSave: () => void; saving: boolean }) {
  const dragIndex = useRef<number | null>(null)
  const [manual, setManual] = useState('')
  function reorder(target: number) {
    if (dragIndex.current == null || dragIndex.current === target) return
    const rows = [...keywords]
    const [moved] = rows.splice(dragIndex.current, 1)
    rows.splice(target, 0, moved)
    onChange(rows.map((row, index) => ({ ...row, rank: index + 1 })))
    dragIndex.current = null
  }
  function add() {
    const label = manual.trim()
    if (!label || keywords.some((row) => row.label.toLocaleLowerCase() === label.toLocaleLowerCase())) return
    onChange([...keywords, { label, rank: keywords.length + 1, source: 'manual', confirmed: true }])
    setManual('')
  }
  return <div className="pk-keyword-editor">
    {keywords.length === 0 && <div className="pk-empty">No keywords yet.</div>}
    {keywords.map((row, index) => <div className={row.confirmed ? 'pk-keyword confirmed' : 'pk-keyword suggested'} key={`${row.label}-${index}`} draggable onDragStart={() => { dragIndex.current = index }} onDragOver={(event) => event.preventDefault()} onDrop={() => reorder(index)}>
      <span className="pk-drag">≡</span>
      <span className="pk-rank">#{index + 1}</span>
      <input value={row.label} onChange={(event) => onChange(keywords.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} />
      <button type="button" className={row.confirmed ? 'confirmed' : ''} onClick={() => onChange(keywords.map((item, i) => i === index ? { ...item, confirmed: !item.confirmed } : item))}>{row.confirmed ? '✓ Confirmed' : 'Confirm'}</button>
      <button type="button" aria-label="Remove keyword" onClick={() => onChange(keywords.filter((_, i) => i !== index).map((item, i) => ({ ...item, rank: i + 1 })))}>×</button>
    </div>)}
    <div className="pk-inline-add"><input value={manual} onChange={(event) => setManual(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') add() }} placeholder="Add keyword manually" /><button type="button" onClick={add}>+ Add</button></div>
    <button type="button" className="primary-button compact" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save keywords'}</button>
  </div>
}

function CharacterEditor({ characters, onChange, onSave, onEnrich, saving }: { characters: CharacterKnowledge[]; onChange: (rows: CharacterKnowledge[]) => void; onSave: () => void; onEnrich: (id: string) => void; saving: boolean }) {
  const dragIndex = useRef<number | null>(null)
  const [manual, setManual] = useState('')
  function normalize(rows: CharacterKnowledge[]) { return rows.map((row, index) => ({ ...row, rank: index + 1 })) }
  function reorder(target: number) {
    if (dragIndex.current == null || dragIndex.current === target) return
    const rows = [...characters]
    const [moved] = rows.splice(dragIndex.current, 1)
    rows.splice(target, 0, moved)
    onChange(normalize(rows))
    dragIndex.current = null
  }
  function add() {
    const name = manual.trim()
    if (!name || characters.some((row) => row.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return
    onChange([...characters, { id: `manual-${Date.now()}`, name, rank: characters.length + 1, source: 'manual', confirmed: true, commentVersions: [], keywords: [] }])
    setManual('')
  }
  return <div className="pk-character-editor">
    {characters.length === 0 && <div className="pk-empty">No characters identified yet.</div>}
    {characters.map((row, index) => <div className={row.confirmed ? 'pk-character-row confirmed' : 'pk-character-row suggested'} key={row.id} draggable onDragStart={() => { dragIndex.current = index }} onDragOver={(event) => event.preventDefault()} onDrop={() => reorder(index)}>
      <span className="pk-drag" title="Drag to rank">≡</span>
      <span className="pk-rank">#{index + 1}</span>
      <input value={row.name} onChange={(event) => onChange(characters.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} />
      <small>{row.confirmed ? 'Confirmed' : row.source === 'ai_suggested' ? 'Suggestion' : 'Manual'}</small>
      <button type="button" onClick={() => onChange(characters.map((item, i) => i === index ? { ...item, confirmed: !item.confirmed } : item))}>{row.confirmed ? '✓' : 'Confirm'}</button>
      <button type="button" onClick={() => onEnrich(row.id)} disabled={!row.confirmed}>Enrich</button>
      <button type="button" aria-label="Remove character" onClick={() => onChange(normalize(characters.filter((_, i) => i !== index)))}>×</button>
    </div>)}
    <div className="pk-inline-add"><input value={manual} onChange={(event) => setManual(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') add() }} placeholder="Add character manually" /><button type="button" onClick={add}>+ Add</button></div>
    <small className="pk-order-help">Character order represents your personal importance/preference inside this work. Dragging is local until Save characters.</small>
    <button type="button" className="primary-button compact" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save characters'}</button>
  </div>
}

function VersionNav({ versions, cursor, onCursor, onRestore }: { versions: CommentVersion[]; cursor: number; onCursor: (version: number) => void; onRestore: () => void }) {
  if (!versions.length) return null
  const index = Math.max(0, versions.findIndex((version) => version.versionNumber === cursor))
  const latest = versions.at(-1)!.versionNumber
  return <div className="pk-version-nav">
    <button type="button" disabled={index <= 0} onClick={() => onCursor(versions[index - 1].versionNumber)}>←</button>
    <span>V{cursor} / V{latest}</span>
    <button type="button" disabled={index >= versions.length - 1} onClick={() => onCursor(versions[index + 1].versionNumber)}>→</button>
    {cursor !== latest && <button type="button" className="ghost-button compact" onClick={onRestore}>Restore this version</button>}
  </div>
}

export default function AIEnrichmentWorkspace({ work, onClose, onSaved }: { work: ManagedCatalogWork; onClose: () => void; onSaved: (profile: PersonalKnowledge, comment: AnimeComment | null) => void }) {
  const [tab, setTab] = useState<WorkspaceTab>('conversation')
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<PersonalKnowledge | null>(null)
  const [existingComment, setExistingComment] = useState<AnimeComment | null>(null)
  const [cursor, setCursor] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftSource, setDraftSource] = useState<VersionSource>('manual')
  const [recording, setRecording] = useState(false)
  const [speechUnavailable, setSpeechUnavailable] = useState(false)
  const [busy, setBusy] = useState<'save' | 'organize' | 'keywords' | 'characters' | 'structured' | 'character' | null>(null)
  const [status, setStatus] = useState('')
  const [assistantNote, setAssistantNote] = useState('')
  const [organizedSuggestion, setOrganizedSuggestion] = useState<string | null>(null)
  const [suggestionEditing, setSuggestionEditing] = useState(false)
  const [characterFocus, setCharacterFocus] = useState<string | null>(null)
  const [characterEditing, setCharacterEditing] = useState(false)
  const [characterDraft, setCharacterDraft] = useState('')
  const [characterSuggestion, setCharacterSuggestion] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  useEffect(() => {
    let live = true
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    void listAnimeComments().then(async (comments) => {
      const comment = work.primaryMalId ? comments.find((row) => row.malId === work.primaryMalId) ?? null : null
      const knowledge = await loadPersonalKnowledge(work.id, work.primaryMalId, comment?.contentText ?? '')
      if (!live) return
      setExistingComment(comment)
      setProfile(knowledge)
      const current = currentWorkVersion(knowledge)
      setCursor(current?.versionNumber ?? 0)
      const localDraft = readDraft(work.id)
      setDraft(localDraft || current?.content || '')
      setAssistantNote(current ? 'Your comment is saved. What would you like to do next?' : 'Tell me what you thought about this work. You can type or speak.')
      setLoading(false)
    })
    return () => { live = false; recognitionRef.current?.stop(); document.body.style.overflow = previous }
  }, [work.id, work.primaryMalId])

  useEffect(() => { if (editing) writeDraft(work.id, draft) }, [draft, editing, work.id])

  const viewedVersion = useMemo(() => profile?.versions.find((version) => version.versionNumber === cursor) ?? null, [profile, cursor])
  const latestVersion = profile?.versions.at(-1) ?? null
  const character = profile?.characters.find((row) => row.id === characterFocus) ?? null
  const characterLatest = character?.commentVersions.at(-1) ?? null

  function startSpeech(target: 'work' | 'character' = 'work') {
    const Ctor = recognitionCtor()
    if (!Ctor) { setSpeechUnavailable(true); return }
    const recognition = new Ctor()
    recognition.lang = 'pt-BR'; recognition.continuous = true; recognition.interimResults = false
    recognition.onresult = (event) => {
      let text = ''
      for (let index = event.resultIndex ?? 0; index < event.results.length; index += 1) text += `${event.results[index][0].transcript} `
      const addition = text.trim()
      if (!addition) return
      if (target === 'character') {
        setCharacterEditing(true)
        setCharacterDraft((current) => `${current}${current.trim() ? '\n\n' : ''}${addition}`)
      } else {
        setEditing(true); setDraftSource('voice')
        setDraft((current) => `${current}${current.trim() ? '\n\n' : ''}${addition}`)
      }
    }
    recognition.onerror = () => setRecording(false)
    recognition.onend = () => setRecording(false)
    recognitionRef.current = recognition
    recognition.start(); setRecording(true); setSpeechUnavailable(false)
  }
  function stopSpeech() { recognitionRef.current?.stop(); setRecording(false) }

  async function persist(next: PersonalKnowledge, note: string) {
    setBusy('structured')
    try {
      const saved = await savePersonalKnowledge(next)
      setProfile(saved)
      setStatus(saved.storage === 'supabase' ? note : `${note} Saved locally; run the V2 Supabase migration to sync across devices.`)
      onSaved(saved, existingComment)
      return saved
    } finally { setBusy(null) }
  }

  async function saveComment(source: VersionSource = draftSource) {
    if (!profile || !draft.trim()) return
    setBusy('save')
    try {
      const next = appendWorkVersion(profile, draft.trim(), source)
      const saved = await savePersonalKnowledge(next)
      let comment = existingComment
      if (work.primaryMalId) comment = await saveAnimeComment(work.primaryMalId, textToHtml(draft.trim()), draft.trim())
      setExistingComment(comment)
      setProfile(saved); setCursor(saved.currentVersionNumber); clearDraft(work.id); setEditing(false); setDraftSource('manual')
      setAssistantNote('Comment saved. What would you like to do next?')
      setStatus(`✓ V${saved.currentVersionNumber} saved.`)
      onSaved(saved, comment)
    } finally { setBusy(null) }
  }

  async function restoreVersion() {
    if (!profile || !viewedVersion) return
    const next = appendWorkVersion(profile, viewedVersion.content, 'restored')
    const saved = await savePersonalKnowledge(next)
    setProfile(saved); setCursor(saved.currentVersionNumber); setDraft(viewedVersion.content)
    let comment = existingComment
    if (work.primaryMalId) comment = await saveAnimeComment(work.primaryMalId, textToHtml(viewedVersion.content), viewedVersion.content)
    setExistingComment(comment)
    setAssistantNote(`V${viewedVersion.versionNumber} was restored as a new V${saved.currentVersionNumber}. Later versions remain preserved.`)
    onSaved(saved, comment)
  }

  async function organizeWork() {
    if (!profile || !latestVersion?.content) return
    setBusy('organize'); setAssistantNote('Organizing your text without changing its meaning…')
    try {
      const result = await AIService.organizeComment(latestVersion.content, { workName: work.displayName, originalObservations: work.originalObservations })
      if (!result.available) { setAssistantNote(result.message ?? 'Advanced organization requires AI.'); return }
      setOrganizedSuggestion(result.data); setSuggestionEditing(false)
      setAssistantNote('I prepared an organized version of your comment. Review it before accepting.')
    } catch { setAssistantNote('The AI could not organize the text right now. Your original comment was preserved.') }
    finally { setBusy(null) }
  }

  async function acceptOrganized() {
    if (!profile || !organizedSuggestion?.trim()) return
    const next = appendWorkVersion(profile, organizedSuggestion.trim(), 'ai_organized')
    const saved = await savePersonalKnowledge(next)
    setProfile(saved); setCursor(saved.currentVersionNumber); setDraft(organizedSuggestion.trim()); setOrganizedSuggestion(null)
    let comment = existingComment
    if (work.primaryMalId) comment = await saveAnimeComment(work.primaryMalId, textToHtml(organizedSuggestion.trim()), organizedSuggestion.trim())
    setExistingComment(comment)
    setAssistantNote(`The organized version was accepted as V${saved.currentVersionNumber}. The previous version remains preserved.`)
    onSaved(saved, comment)
  }

  async function identifyKeywords() {
    if (!profile || !latestVersion?.content) return
    setBusy('keywords'); setAssistantNote('Identifying only characteristics supported by your current comment…')
    try {
      const result = await AIService.extractKeywords(latestVersion.content, { workName: work.displayName })
      const next = { ...profile, keywords: mergeKeywords(profile.keywords, result.data) }
      setProfile(next); setTab('profile')
      setAssistantNote(result.data.length ? `I found ${result.data.length} keyword suggestions. Confirm, remove, edit and rank them in the Profile panel.` : 'I did not find reliable keywords. You can add them manually.')
      if (result.message) setStatus(result.message)
    } catch { setAssistantNote('Keywords could not be identified right now.') }
    finally { setBusy(null) }
  }

  async function identifyCharacters() {
    if (!profile || !latestVersion?.content) return
    setBusy('characters'); setAssistantNote('Identifying only character names mentioned in your current comment…')
    try {
      const result = await AIService.extractCharacters(latestVersion.content, { workName: work.displayName })
      const next = { ...profile, characters: mergeCharacters(profile.characters, result.data) }
      setProfile(next); setTab('profile')
      setAssistantNote(result.data.length ? `I found ${result.data.length} possible characters. Correct, confirm and rank them before saving.` : 'I did not find characters with enough confidence. You can add them manually.')
      if (result.message) setStatus(result.message)
    } catch { setAssistantNote('Characters could not be identified right now.') }
    finally { setBusy(null) }
  }

  async function saveKeywords() {
    if (!profile) return
    await persist({ ...profile, keywords: profile.keywords.map((row, index) => ({ ...row, rank: index + 1 })) }, '✓ Keywords saved.')
    setAssistantNote('Keywords saved. You can identify characters or return to the comment.')
  }
  async function saveCharacters() {
    if (!profile) return
    const next = { ...profile, characters: profile.characters.map((row, index) => ({ ...row, rank: index + 1 })) }
    await persist(next, '✓ Characters saved.')
    setAssistantNote('Characters saved. You can enrich a character or finish this session.')
  }

  function focusCharacter(characterId: string) {
    if (!profile) return
    const row = profile.characters.find((item) => item.id === characterId)
    if (!row) return
    setCharacterFocus(characterId); setCharacterDraft(readDraft(`${work.id}:character:${characterId}`) || row.commentVersions.at(-1)?.content || ''); setCharacterEditing(!row.commentVersions.length); setCharacterSuggestion(null); setTab('conversation')
    setAssistantNote(`What do you think about ${row.name}? You can type or speak.`)
  }

  async function saveCharacterComment(source: VersionSource = 'manual') {
    if (!profile || !character || !characterDraft.trim()) return
    setBusy('character')
    try {
      const next = appendCharacterVersion(profile, character.id, characterDraft.trim(), source)
      const saved = await savePersonalKnowledge(next)
      clearDraft(`${work.id}:character:${character.id}`); setProfile(saved); setCharacterEditing(false); setAssistantNote(`Your comment about ${character.name} was saved. You can organize it or identify character keywords.`); onSaved(saved, existingComment)
    } finally { setBusy(null) }
  }

  async function organizeCharacter() {
    if (!characterLatest?.content || !character) return
    setBusy('character')
    try {
      const result = await AIService.organizeCharacterComment(characterLatest.content, character.name, work.displayName)
      if (!result.available) setAssistantNote(result.message ?? 'Advanced organization requires AI.')
      else { setCharacterSuggestion(result.data); setAssistantNote(`I prepared an organized version of your comment about ${character.name}.`) }
    } finally { setBusy(null) }
  }

  async function acceptCharacterSuggestion() {
    if (!profile || !character || !characterSuggestion?.trim()) return
    const next = appendCharacterVersion(profile, character.id, characterSuggestion.trim(), 'ai_organized')
    const saved = await savePersonalKnowledge(next)
    setProfile(saved); setCharacterDraft(characterSuggestion.trim()); setCharacterSuggestion(null); setAssistantNote(`A new version of your ${character.name} comment was saved.`); onSaved(saved, existingComment)
  }

  async function characterKeywords() {
    if (!profile || !character || !characterLatest?.content) return
    setBusy('character')
    try {
      const result = await AIService.extractCharacterKeywords(characterLatest.content, character.name)
      const next = { ...profile, characters: profile.characters.map((row) => row.id === character.id ? { ...row, keywords: mergeKeywords(row.keywords, result.data) } : row) }
      setProfile(next); setTab('profile'); setAssistantNote(`${character.name} keywords are ready for review.`); if (result.message) setStatus(result.message)
    } finally { setBusy(null) }
  }

  async function saveCharacterKeywords(characterId: string, keywords: KnowledgeKeyword[]) {
    if (!profile) return
    const next = { ...profile, characters: profile.characters.map((row) => row.id === characterId ? { ...row, keywords: keywords.map((keyword, index) => ({ ...keyword, rank: index + 1 })) } : row) }
    await persist(next, `✓ Character keywords saved.`)
  }

  if (loading || !profile) return createPortal(<div className="ai-enrichment-backdrop"><div className="ai-enrichment-loading"><span className="spinner" /><strong>Opening Personal Knowledge…</strong></div></div>, document.body)

  return createPortal(<div className="ai-enrichment-backdrop">
    <section className="ai-enrichment-workspace pk-workspace" role="dialog" aria-modal="true" aria-label={`AI Personal Knowledge — ${work.displayName}`}>
      <header className="ai-enrichment-header"><div><span className="eyebrow">AI PERSONAL KNOWLEDGE</span><h1>{character ? `${work.displayName} · ${character.name}` : work.displayName}</h1></div><div><span className="ai-enrichment-title">Guided knowledge editor</span><button type="button" onClick={onClose} aria-label="Close">×</button></div></header>
      <div className="ai-mobile-tabs"><button className={tab === 'conversation' ? 'active' : ''} onClick={() => setTab('conversation')}>Conversation</button><button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>Profile</button></div>

      <div className="ai-enrichment-body pk-body">
        <aside className={tab === 'conversation' ? 'ai-conversation pk-chat active' : 'ai-conversation pk-chat'}>
          <div className="pk-message assistant"><span className="pk-avatar">AI</span><div><p>{assistantNote}</p>{busy && <small className="pk-thinking"><span className="spinner" /> Working…</small>}</div></div>

          {!character && <>
            {viewedVersion && <div className="pk-message user"><div className="pk-user-bubble" onClick={() => { if (cursor === profile.versions.at(-1)?.versionNumber) { setDraft(viewedVersion.content); setEditing(true) } }}>
              {editing && cursor === profile.versions.at(-1)?.versionNumber ? <textarea autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onClick={(event) => event.stopPropagation()} /> : <p>{viewedVersion.content}</p>}
              <small>You · V{viewedVersion.versionNumber}</small>
            </div></div>}
            {!viewedVersion && <div className="pk-message user"><div className="pk-user-bubble empty" onClick={() => setEditing(true)}>{editing ? <textarea autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onClick={(event) => event.stopPropagation()} placeholder="Write what you thought…" /> : <p>Click to write your first comment.</p>}<small>You · new comment</small></div></div>}

            <VersionNav versions={profile.versions} cursor={cursor} onCursor={(version) => { setCursor(version); setEditing(false); setOrganizedSuggestion(null) }} onRestore={restoreVersion} />

            {editing && cursor === (profile.versions.at(-1)?.versionNumber ?? cursor) && <div className="pk-compose-actions">
              <button type="button" className={recording ? 'ghost-button recording' : 'ghost-button'} onClick={() => recording ? stopSpeech() : startSpeech('work')}>{recording ? '■ Stop' : '🎙️ Speak'}</button>
              <button type="button" className="primary-button" onClick={() => void saveComment()} disabled={!draft.trim() || busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save new version'}</button>
              <button type="button" className="text-button" onClick={() => { setEditing(false); setDraft(latestVersion?.content ?? '') }}>Cancel edit</button>
            </div>}
            {speechUnavailable && <div className="pk-inline-warning">Speech recognition is not available in this browser.</div>}

            {organizedSuggestion && <div className="pk-message assistant"><span className="pk-avatar">AI</span><div className="pk-suggestion"><strong>Organized suggestion</strong>{suggestionEditing ? <textarea value={organizedSuggestion} onChange={(event) => setOrganizedSuggestion(event.target.value)} /> : <p>{organizedSuggestion}</p>}<div><button className="primary-button compact" type="button" onClick={acceptOrganized}>✓ Use this version</button><button className="ghost-button compact" type="button" onClick={() => setSuggestionEditing(true)}>✏️ Edit</button><button className="text-button" type="button" onClick={() => { setOrganizedSuggestion(null); setAssistantNote('Your original text was kept.') }}>✕ Keep my text</button></div></div></div>}

            {latestVersion && !editing && !organizedSuggestion && <div className="pk-context-actions"><span>What do you want to do?</span><button type="button" onClick={organizeWork} disabled={Boolean(busy)}>✨ Organize text with AI</button><button type="button" onClick={identifyKeywords} disabled={Boolean(busy)}>🏷️ Identify keywords</button><button type="button" onClick={identifyCharacters} disabled={Boolean(busy)}>👤 Identify characters</button></div>}
          </>}

          {character && <>
            <button type="button" className="text-button pk-back" onClick={() => { setCharacterFocus(null); setCharacterSuggestion(null); setAssistantNote('The work comment is in focus again.') }}>← Back to work</button>
            <div className="pk-message assistant"><span className="pk-avatar">AI</span><div><p>What do you think about {character.name}?</p></div></div>
            <div className="pk-message user"><div className="pk-user-bubble" onClick={() => { setCharacterDraft(characterLatest?.content ?? ''); setCharacterEditing(true) }}>
              {characterEditing ? <textarea autoFocus value={characterDraft} onChange={(event) => { setCharacterDraft(event.target.value); writeDraft(`${work.id}:character:${character.id}`, event.target.value) }} onClick={(event) => event.stopPropagation()} placeholder={`Write about ${character.name}…`} /> : <p>{characterLatest?.content || 'Click to add a personal comment.'}</p>}
              <small>You · {characterLatest ? `V${characterLatest.versionNumber}` : 'new comment'}</small>
            </div></div>
            {characterEditing && <div className="pk-compose-actions"><button className={recording ? 'ghost-button recording' : 'ghost-button'} type="button" onClick={() => recording ? stopSpeech() : startSpeech('character')}>{recording ? '■ Stop' : '🎙️ Speak'}</button><button className="primary-button" type="button" onClick={() => saveCharacterComment()} disabled={!characterDraft.trim() || Boolean(busy)}>Save character version</button></div>}
            {characterSuggestion && <div className="pk-message assistant"><span className="pk-avatar">AI</span><div className="pk-suggestion"><strong>Organized suggestion</strong><p>{characterSuggestion}</p><div><button className="primary-button compact" onClick={acceptCharacterSuggestion}>✓ Use this version</button><button className="text-button" onClick={() => setCharacterSuggestion(null)}>Keep my text</button></div></div></div>}
            {characterLatest && !characterEditing && !characterSuggestion && <div className="pk-context-actions"><button type="button" onClick={organizeCharacter} disabled={Boolean(busy)}>✨ Organize text with AI</button><button type="button" onClick={characterKeywords} disabled={Boolean(busy)}>🏷️ Identify keywords</button></div>}
          </>}

          {status && <div className="pk-status">{status}</div>}
          <small className="pk-privacy">Only this work, its current personal knowledge and minimal context are processed. Original Observations are never overwritten.</small>
        </aside>

        <main className={tab === 'profile' ? 'ai-profile-panel pk-profile active' : 'ai-profile-panel pk-profile'}>
          <section className="ai-profile-card"><div className="ai-profile-card-title"><div><span>COMMENT</span><strong>Current comment</strong></div><small>{profile.versions.length} version{profile.versions.length === 1 ? '' : 's'}</small></div><p>{currentWorkVersion(profile)?.content || 'No saved comment yet.'}</p></section>

          <section className="ai-profile-card"><div className="ai-profile-card-title"><div><span>KEYWORDS</span><strong>Personal signals</strong></div><small>{profile.keywords.filter((row) => row.confirmed).length} confirmed</small></div><KeywordEditor keywords={profile.keywords} onChange={(keywords) => setProfile({ ...profile, keywords })} onSave={saveKeywords} saving={busy === 'structured'} /></section>

          <section className="ai-profile-card"><div className="ai-profile-card-title"><div><span>CHARACTERS</span><strong>Personal character ranking</strong></div><small>{profile.characters.filter((row) => row.confirmed).length} confirmed</small></div><CharacterEditor characters={profile.characters} onChange={(characters) => setProfile({ ...profile, characters })} onSave={saveCharacters} onEnrich={focusCharacter} saving={busy === 'structured'} />
            {profile.characters.filter((row) => row.confirmed).sort((a, b) => a.rank - b.rank).map((row) => <article key={`summary-${row.id}`} className="pk-character-summary"><button type="button" onClick={() => focusCharacter(row.id)}><strong>#{row.rank} {row.name}</strong><span>{row.keywords.filter((keyword) => keyword.confirmed).length} keywords · {row.commentVersions.length ? '✓ Enriched' : 'No comment yet'}</span></button>{row.keywords.length > 0 && <KeywordEditor keywords={row.keywords} onChange={(keywords) => setProfile({ ...profile, characters: profile.characters.map((item) => item.id === row.id ? { ...item, keywords } : item) })} onSave={() => saveCharacterKeywords(row.id, row.keywords)} saving={busy === 'structured'} />}</article>)}
          </section>
        </main>
      </div>
      <footer className="ai-enrichment-footer"><span>{profile.storage === 'supabase' ? 'Supabase synced' : 'Local cache active'}</span><button type="button" className="ghost-button" onClick={onClose}>Close workspace</button></footer>
    </section>
  </div>, document.body)
}
