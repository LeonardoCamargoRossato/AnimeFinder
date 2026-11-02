import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type VoiceState = 'idle' | 'listening' | 'processing' | 'ready' | 'error' | 'unsupported'

type SpeechRecognitionResultLike = {
  isFinal: boolean
  length: number
  [index: number]: { transcript: string }
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: {
    length: number
    [index: number]: SpeechRecognitionResultLike
  }
}

type SpeechRecognitionErrorLike = { error: string }

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: (() => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

const VOICE_HOST = 'data-hamlet-voice-input-host'

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  const speechWindow = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

function normalizeTranscript(value: string) {
  let text = value
    .replace(/[\u00a0\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?=[^\s])/g, '$1 ')
    .trim()

  if (!text) return ''
  text = text.charAt(0).toLocaleUpperCase() + text.slice(1)
  if (!/[.!?…]$/.test(text)) text += '.'
  return text
}

function updateReactTextarea(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (setter) setter.call(textarea, value)
  else textarea.value = value
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.focus()
  textarea.setSelectionRange(value.length, value.length)
}

function feedbackForError(error: string) {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was denied. Allow microphone access for AnimeFinder and try again.'
    case 'audio-capture':
      return 'No microphone is available, or another app is using it.'
    case 'no-speech':
      return "I didn't catch that. Try speaking again."
    case 'network':
      return 'The browser speech service could not connect. Try again; if it persists, check Edge speech/microphone permissions.'
    default:
      return 'Voice input stopped. You can try again or keep typing.'
  }
}

function feedbackForMediaError(reason: unknown) {
  if (reason instanceof DOMException) {
    if (reason.name === 'NotAllowedError' || reason.name === 'SecurityError') {
      return 'Microphone access was denied. Allow microphone access for AnimeFinder and try again.'
    }
    if (reason.name === 'NotFoundError') return 'No microphone was found on this device.'
    if (reason.name === 'NotReadableError') return 'The microphone is busy or unavailable. Close other apps using it and try again.'
  }
  return 'Could not access the microphone. Check browser permissions and try again.'
}

export default function HamletVoiceInputEnhancer() {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [state, setState] = useState<VoiceState>('idle')
  const [feedback, setFeedback] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const baseDraftRef = useRef('')
  const finalTranscriptRef = useRef('')
  const interimTranscriptRef = useRef('')
  const cancelledRef = useRef(false)
  const errorRef = useRef(false)
  const feedbackTimerRef = useRef<number | null>(null)

  function showFeedback(message: string, duration = 3600) {
    if (feedbackTimerRef.current != null) window.clearTimeout(feedbackTimerRef.current)
    setFeedback(message)
    if (duration > 0) {
      feedbackTimerRef.current = window.setTimeout(() => setFeedback(''), duration)
    }
  }

  useEffect(() => {
    const root = document.getElementById('root')
    if (!root) return

    const sync = () => {
      const composer = document.querySelector('.hamlet-composer') as HTMLFormElement | null
      if (!composer) {
        setHost(null)
        return
      }

      composer.classList.add('hamlet-composer-voice-enabled')
      let nextHost = composer.querySelector(`[${VOICE_HOST}]`) as HTMLElement | null
      if (!nextHost) {
        nextHost = document.createElement('div')
        nextHost.setAttribute(VOICE_HOST, 'true')
        nextHost.className = 'hamlet-voice-host'
        const sendButton = composer.querySelector('button[type="submit"]')
        composer.insertBefore(nextHost, sendButton)
      }
      setHost((current) => current === nextHost ? current : nextHost)
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      recognitionRef.current?.abort()
      recognitionRef.current = null
      document.querySelector('.hamlet-composer')?.classList.remove('hamlet-composer-voice-enabled')
      document.querySelector(`[${VOICE_HOST}]`)?.remove()
      if (feedbackTimerRef.current != null) window.clearTimeout(feedbackTimerRef.current)
    }
  }, [])

  function cancelListening() {
    cancelledRef.current = true
    errorRef.current = false
    recognitionRef.current?.abort()
    recognitionRef.current = null
    setState('idle')
    showFeedback('Voice input cancelled.', 1800)
  }

  async function beginListening() {
    if (state === 'listening') {
      cancelListening()
      return
    }

    const SpeechRecognition = getSpeechRecognition()
    if (!SpeechRecognition) {
      setState('unsupported')
      showFeedback('Voice input is not supported in this browser. You can keep typing normally.', 5200)
      return
    }

    const textarea = document.querySelector('.hamlet-composer textarea') as HTMLTextAreaElement | null
    if (!textarea) return

    setFeedback('')

    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach((track) => track.stop())
      } catch (reason) {
        setState('error')
        showFeedback(feedbackForMediaError(reason), 5600)
        return
      }
    }

    const recognition = new SpeechRecognition()
    recognitionRef.current = recognition
    baseDraftRef.current = textarea.value.trim()
    finalTranscriptRef.current = ''
    interimTranscriptRef.current = ''
    cancelledRef.current = false
    errorRef.current = false

    // Prefer the user's browser/OS language. The app UI can be English while the user speaks Portuguese.
    recognition.lang = navigator.language || document.documentElement.lang || 'pt-BR'
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setState('listening')
      showFeedback('Listening… tap the microphone again to cancel.', 0)
    }

    recognition.onresult = (event) => {
      let finalText = finalTranscriptRef.current
      let interimText = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const transcript = result[0]?.transcript?.trim() ?? ''
        if (!transcript) continue
        if (result.isFinal) finalText = `${finalText} ${transcript}`.trim()
        else interimText = `${interimText} ${transcript}`.trim()
      }
      finalTranscriptRef.current = finalText
      interimTranscriptRef.current = interimText
    }

    recognition.onerror = (event) => {
      if (cancelledRef.current) return
      errorRef.current = true
      setState('error')
      showFeedback(feedbackForError(event.error), 5600)
    }

    recognition.onend = () => {
      recognitionRef.current = null
      if (cancelledRef.current) {
        cancelledRef.current = false
        return
      }
      if (errorRef.current) {
        errorRef.current = false
        return
      }

      // Some Chromium/Edge sessions end with a useful interim result but no final result.
      const transcript = (finalTranscriptRef.current || interimTranscriptRef.current).trim()
      if (!transcript) {
        setState('idle')
        showFeedback("I didn't catch anything. Try speaking again.", 3200)
        return
      }

      setState('processing')
      showFeedback('Processing transcription…', 0)
      window.setTimeout(() => {
        const currentTextarea = document.querySelector('.hamlet-composer textarea') as HTMLTextAreaElement | null
        if (!currentTextarea) {
          setState('idle')
          setFeedback('')
          return
        }
        const cleaned = normalizeTranscript(transcript)
        const base = baseDraftRef.current
        const nextValue = base ? `${base} ${cleaned}` : cleaned
        updateReactTextarea(currentTextarea, nextValue)
        setState('ready')
        showFeedback('Transcription ready — review or edit it before sending.', 4200)
        window.setTimeout(() => setState('idle'), 1500)
      }, 120)
    }

    try {
      recognition.start()
    } catch {
      recognitionRef.current = null
      setState('error')
      showFeedback('Could not start speech recognition. Check microphone permission and try again.', 4600)
    }
  }

  if (!host) return null

  const label = state === 'listening'
    ? 'Cancel voice input'
    : state === 'processing'
      ? 'Processing voice input'
      : 'Start voice input'

  return createPortal(
    <div className={`hamlet-voice-control is-${state}`}>
      <button
        className="hamlet-voice-button"
        type="button"
        onClick={() => void beginListening()}
        disabled={state === 'processing'}
        aria-label={label}
        title={label}
        aria-pressed={state === 'listening'}
      >
        <span aria-hidden="true">{state === 'listening' ? '■' : state === 'processing' ? '…' : state === 'ready' ? '✓' : '🎙'}</span>
      </button>
      {feedback && <span className="hamlet-voice-feedback" role="status" aria-live="polite">{feedback}</span>}
    </div>,
    host,
  )
}
