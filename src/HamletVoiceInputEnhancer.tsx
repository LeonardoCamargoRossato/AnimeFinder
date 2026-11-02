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
const WAVEFORM_BAR_COUNT = 28
const IDLE_LEVELS = Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => 0.06 + ((index * 7) % 6) * 0.018)
const STOP_GRACE_MS = 420

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  const speechWindow = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

function getAudioContextConstructor() {
  const audioWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext }
  return window.AudioContext ?? audioWindow.webkitAudioContext ?? null
}

function normalizeTranscript(value: string) {
  let text = value
    .replace(/[\u00a0\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?=[^\s])/g, '$1 ')
    .trim()

  if (!text) return ''
  text = text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1)
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
      return 'Não consegui identificar a fala. Tente novamente.'
    case 'network':
      return 'The browser speech service could not connect. Try again; if it persists, check browser speech and microphone permissions.'
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
  const [levels, setLevels] = useState<number[]>(IDLE_LEVELS)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const finishTimerRef = useRef<number | null>(null)
  const lastMeterUpdateRef = useRef(0)
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

  function clearFinishTimer() {
    if (finishTimerRef.current != null) {
      window.clearTimeout(finishTimerRef.current)
      finishTimerRef.current = null
    }
  }

  function stopAudioMeter(resetLevels = true) {
    if (animationFrameRef.current != null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined)
      audioContextRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (resetLevels) setLevels(IDLE_LEVELS)
  }

  function startAudioMeter(stream: MediaStream) {
    const AudioContextConstructor = getAudioContextConstructor()
    if (!AudioContextConstructor) return

    const audioContext = new AudioContextConstructor()
    const analyser = audioContext.createAnalyser()
    const source = audioContext.createMediaStreamSource(stream)
    analyser.fftSize = 128
    analyser.smoothingTimeConstant = 0.68
    source.connect(analyser)
    audioContextRef.current = audioContext
    void audioContext.resume().catch(() => undefined)

    const frequencyData = new Uint8Array(analyser.frequencyBinCount)
    const selectedBins = Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
      const available = Math.max(2, frequencyData.length - 3)
      return Math.min(frequencyData.length - 1, 1 + Math.round((index / Math.max(1, WAVEFORM_BAR_COUNT - 1)) * available))
    })

    const tick = (timestamp: number) => {
      if (timestamp - lastMeterUpdateRef.current >= 48) {
        analyser.getByteFrequencyData(frequencyData)
        const nextLevels = selectedBins.map((bin, index) => {
          const raw = frequencyData[bin] / 255
          const shaped = raw * 2.55 + IDLE_LEVELS[index] * 0.08
          return Math.min(1, Math.max(0.035, shaped))
        })
        setLevels(nextLevels)
        lastMeterUpdateRef.current = timestamp
      }
      animationFrameRef.current = window.requestAnimationFrame(tick)
    }

    animationFrameRef.current = window.requestAnimationFrame(tick)
  }

  function finalizeTranscript() {
    clearFinishTimer()
    const transcript = [finalTranscriptRef.current, interimTranscriptRef.current].filter(Boolean).join(' ').trim()
    if (!transcript) {
      setState('idle')
      showFeedback('Não consegui identificar a fala. Tente novamente.', 3200)
      return
    }

    setState('processing')
    showFeedback('Transcrevendo…', 0)
    window.setTimeout(() => {
      const currentTextarea = document.querySelector('.hamlet-composer textarea') as HTMLTextAreaElement | null
      if (!currentTextarea) {
        setState('idle')
        setFeedback('')
        return
      }
      const cleaned = normalizeTranscript(transcript)
      const base = baseDraftRef.current.trim()
      const nextValue = base ? `${base}${/[.!?…]$/.test(base) ? ' ' : '. '}${cleaned}` : cleaned
      updateReactTextarea(currentTextarea, nextValue)
      setState('ready')
      showFeedback('Transcrição pronta — revise ou edite antes de enviar.', 4200)
      window.setTimeout(() => setState('idle'), 1500)
    }, 90)
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
      cancelledRef.current = true
      clearFinishTimer()
      recognitionRef.current?.abort()
      recognitionRef.current = null
      stopAudioMeter(false)
      document.querySelector('.hamlet-composer')?.classList.remove('hamlet-composer-voice-enabled')
      document.querySelector(`[${VOICE_HOST}]`)?.remove()
      if (feedbackTimerRef.current != null) window.clearTimeout(feedbackTimerRef.current)
    }
  }, [])

  function cancelListening() {
    cancelledRef.current = true
    errorRef.current = false
    clearFinishTimer()
    recognitionRef.current?.abort()
    recognitionRef.current = null
    stopAudioMeter()
    finalTranscriptRef.current = ''
    interimTranscriptRef.current = ''
    setState('idle')
    showFeedback('Gravação cancelada.', 1800)
  }

  function finishListening() {
    if (state !== 'listening') return
    setState('processing')
    showFeedback('Finalizando captura…', 0)
    stopAudioMeter()
    clearFinishTimer()

    // Keep the recognizer alive for a brief grace period so very short utterances
    // such as "teste" still have time to emit their final/interim result.
    finishTimerRef.current = window.setTimeout(() => {
      finishTimerRef.current = null
      try {
        recognitionRef.current?.stop()
      } catch {
        recognitionRef.current = null
        finalizeTranscript()
      }
    }, STOP_GRACE_MS)
  }

  async function beginListening() {
    if (state === 'listening' || state === 'processing') return

    const SpeechRecognition = getSpeechRecognition()
    if (!SpeechRecognition) {
      setState('unsupported')
      showFeedback('Voice input is not supported in this browser. You can keep typing normally.', 5200)
      return
    }

    const textarea = document.querySelector('.hamlet-composer textarea') as HTMLTextAreaElement | null
    if (!textarea) return

    setFeedback('')
    clearFinishTimer()
    stopAudioMeter()

    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
        streamRef.current = stream
        startAudioMeter(stream)
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

    // Keep Hamlet voice input deterministic in Brazilian Portuguese, matching
    // the Personal Knowledge voice flow that is already working well in the app.
    recognition.lang = 'pt-BR'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setState('listening')
      showFeedback('Ouvindo… use ■ para transcrever ou × para cancelar.', 0)
    }

    recognition.onresult = (event) => {
      const finalParts: string[] = []
      const interimParts: string[] = []
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index]
        const transcript = result[0]?.transcript?.trim() ?? ''
        if (!transcript) continue
        if (result.isFinal) finalParts.push(transcript)
        else interimParts.push(transcript)
      }
      finalTranscriptRef.current = finalParts.join(' ').trim()
      interimTranscriptRef.current = interimParts.join(' ').trim()
    }

    recognition.onerror = (event) => {
      if (cancelledRef.current) return
      clearFinishTimer()
      stopAudioMeter()
      errorRef.current = true
      setState('error')
      showFeedback(feedbackForError(event.error), 5600)
    }

    recognition.onend = () => {
      recognitionRef.current = null
      clearFinishTimer()
      stopAudioMeter()
      if (cancelledRef.current) {
        cancelledRef.current = false
        return
      }
      if (errorRef.current) {
        errorRef.current = false
        return
      }
      finalizeTranscript()
    }

    try {
      recognition.start()
    } catch {
      recognitionRef.current = null
      clearFinishTimer()
      stopAudioMeter()
      setState('error')
      showFeedback('Could not start speech recognition. Check microphone permission and try again.', 4600)
    }
  }

  if (!host) return null

  return createPortal(
    <div className={`hamlet-voice-control is-${state}`}>
      {state === 'listening' ? (
        <div className="hamlet-voice-session" aria-label="Voice recording controls">
          <button className="hamlet-voice-cancel" type="button" onClick={cancelListening} aria-label="Cancel voice input" title="Cancelar gravação">×</button>
          <div className="hamlet-voice-waveform" aria-label="Microphone level" role="img">
            {levels.map((level, index) => <span key={index} style={{ height: `${Math.max(5, Math.round(level * 100))}%` }} />)}
          </div>
          <button className="hamlet-voice-stop" type="button" onClick={finishListening} aria-label="Stop and transcribe voice input" title="Parar e transcrever">
            <span aria-hidden="true" />
          </button>
        </div>
      ) : state === 'processing' ? (
        <div className="hamlet-voice-processing-pill" role="status" aria-live="polite"><span className="hamlet-voice-processing-dot" />Transcrevendo</div>
      ) : (
        <button
          className="hamlet-voice-button"
          type="button"
          onClick={() => void beginListening()}
          aria-label="Start voice input"
          title="Falar com Hamlet"
        >
          <span aria-hidden="true" />
        </button>
      )}
      {feedback && <span className="hamlet-voice-feedback" role="status" aria-live="polite">{feedback}</span>}
    </div>,
    host,
  )
}
