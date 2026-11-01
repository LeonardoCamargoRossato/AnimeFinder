import { useEffect, useRef, useState } from 'react'
import { saveAnimeComment, type AnimeComment } from './comments'
import './comments.css'

type SpeechRecognitionResultLike = {
  isFinal: boolean
  [index: number]: { transcript: string }
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: {
    length: number
    [index: number]: SpeechRecognitionResultLike
  }
}

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}

type SpeechWindow = Window & typeof globalThis & {
  SpeechRecognition?: new () => SpeechRecognitionLike
  webkitSpeechRecognition?: new () => SpeechRecognitionLike
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function capitalizeSentence(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.charAt(0).toLocaleUpperCase('pt-BR') + trimmed.slice(1)
}

export function formatSpokenComment(text: string) {
  const cleaned = text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim()
  if (!cleaned) return ''

  const withEnd = /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`
  let sentences = withEnd.match(/[^.!?]+[.!?]+/g)?.map((sentence) => capitalizeSentence(sentence)) ?? [capitalizeSentence(withEnd)]
  if (sentences.length === 1 && sentences[0].split(/\s+/).length > 36) {
    const words = sentences[0].replace(/[.!?]+$/, '').split(/\s+/)
    sentences = []
    for (let i = 0; i < words.length; i += 24) {
      const chunk = words.slice(i, i + 24).join(' ')
      sentences.push(`${capitalizeSentence(chunk)}.`)
    }
  }

  const paragraphs: string[] = []
  let current = ''
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence
    if (candidate.length > 260 && current) {
      paragraphs.push(current)
      current = sentence
    } else {
      current = candidate
    }
  }
  if (current) paragraphs.push(current)
  return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')
}

function sanitizeRichHtml(html: string) {
  const container = document.createElement('div')
  container.innerHTML = html
  const allowed = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'BLOCKQUOTE'])
  const elements = Array.from(container.querySelectorAll('*'))
  for (const element of elements) {
    if (!allowed.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes))
      continue
    }
    Array.from(element.attributes).forEach((attribute) => element.removeAttribute(attribute.name))
  }
  return container.innerHTML.trim()
}

function htmlToText(html: string) {
  const container = document.createElement('div')
  container.innerHTML = html
  return (container.innerText || container.textContent || '').trim()
}

export default function CommentEditor({
  malId,
  animeTitle,
  initialComment,
  onClose,
  onSaved,
}: {
  malId: number
  animeTitle: string
  initialComment?: AnimeComment | null
  onClose: () => void
  onSaved: (comment: AnimeComment) => void
}) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [speechError, setSpeechError] = useState('')

  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = initialComment?.contentHtml || ''
  }, [initialComment?.contentHtml])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (fullscreen) setFullscreen(false)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen, onClose])

  useEffect(() => () => recognitionRef.current?.abort(), [])

  function runCommand(command: string, value?: string) {
    editorRef.current?.focus()
    document.execCommand(command, false, value)
  }

  function insertHtml(html: string) {
    editorRef.current?.focus()
    document.execCommand('insertHTML', false, html)
  }

  function toggleMicrophone() {
    if (listening) {
      recognitionRef.current?.stop()
      return
    }

    const speechWindow = window as SpeechWindow
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
    if (!Recognition) {
      setSpeechError('Voice dictation is not supported by this browser. Try Chrome or Edge.')
      return
    }

    const recognition = new Recognition()
    recognition.lang = 'pt-BR'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognitionRef.current = recognition
    setSpeechError('')
    setInterim('')

    recognition.onresult = (event) => {
      let finalText = ''
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0]?.transcript ?? ''
        if (event.results[i].isFinal) finalText += `${transcript} `
        else interimText += transcript
      }
      if (finalText.trim()) insertHtml(formatSpokenComment(finalText))
      setInterim(interimText.trim())
    }
    recognition.onerror = (event) => {
      setSpeechError(event.error === 'not-allowed' ? 'Microphone permission was denied.' : `Voice recognition error: ${event.error || 'unknown error'}`)
      setListening(false)
      setInterim('')
    }
    recognition.onend = () => {
      setListening(false)
      setInterim('')
    }

    try {
      recognition.start()
      setListening(true)
    } catch {
      setSpeechError('Could not start voice recognition.')
    }
  }

  async function save() {
    if (!editorRef.current) return
    setSaving(true)
    setMessage('')
    try {
      const contentHtml = sanitizeRichHtml(editorRef.current.innerHTML)
      const contentText = htmlToText(contentHtml)
      const saved = await saveAnimeComment(malId, contentHtml, contentText)
      onSaved(saved)
      setMessage(saved.storage === 'supabase' ? 'Note saved.' : 'Note saved locally. Supabase comments table is not available yet.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="comment-editor-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !fullscreen) onClose()
    }}>
      <section className={fullscreen ? 'comment-editor-shell fullscreen' : 'comment-editor-shell'} role="dialog" aria-modal="true" aria-label={`Comments for ${animeTitle}`}>
        <header className="comment-editor-header">
          <div>
            <span className="eyebrow">PERSONAL COMMENTS</span>
            <h2>{animeTitle}</h2>
          </div>
          <div className="comment-editor-main-actions">
            <button type="button" className={listening ? 'comment-icon-button listening' : 'comment-icon-button'} onClick={toggleMicrophone} title={listening ? 'Stop microphone' : 'Dictate comment'} aria-label={listening ? 'Stop microphone' : 'Dictate comment'}>🎙</button>
            <button type="button" className="comment-icon-button" onClick={() => setFullscreen((value) => !value)} title={fullscreen ? 'Restore size' : 'Expand'} aria-label={fullscreen ? 'Restore size' : 'Expand'}>{fullscreen ? '🗗' : '⛶'}</button>
            <button type="button" className="comment-save-button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save note'}</button>
            <button type="button" className="comment-icon-button" onClick={onClose} title="Close" aria-label="Close">×</button>
          </div>
        </header>

        <div className="comment-format-toolbar" aria-label="Text formatting">
          <button type="button" onClick={() => runCommand('bold')}><b>B</b></button>
          <button type="button" onClick={() => runCommand('italic')}><i>I</i></button>
          <button type="button" onClick={() => runCommand('underline')}><u>U</u></button>
          <span />
          <button type="button" onClick={() => runCommand('formatBlock', 'p')}>Paragraph</button>
          <button type="button" onClick={() => runCommand('insertUnorderedList')}>• List</button>
          <button type="button" onClick={() => runCommand('insertOrderedList')}>1. List</button>
        </div>

        <div
          ref={editorRef}
          className="comment-rich-editor"
          contentEditable
          suppressContentEditableWarning
          data-placeholder="Write your comments about this anime…"
        />

        {(listening || interim) && (
          <div className="comment-dictation-status">
            <span className="comment-listening-dot" />
            <strong>{listening ? 'Listening in Portuguese…' : 'Processing…'}</strong>
            {interim && <span>{interim}</span>}
          </div>
        )}
        {speechError && <div className="comment-editor-warning">{speechError}</div>}
        {message && <div className="comment-editor-message">{message}</div>}
        <footer className="comment-editor-footer">Voice text is formatted locally into readable paragraphs with normalized spacing, capitalization and punctuation where possible.</footer>
      </section>
    </div>
  )
}
