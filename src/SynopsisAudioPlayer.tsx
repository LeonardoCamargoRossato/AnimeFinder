import { useEffect, useMemo, useRef, useState } from 'react'

type PlaybackStatus = 'idle' | 'playing' | 'paused'

type SynopsisAudioPlayerProps = {
  text: string
  lang: string
  languageLabel: string
  onClose: () => void
}

type SpeechOverrides = {
  rate?: number
  pitch?: number
  volume?: number
  voice?: SpeechSynthesisVoice | null
}

const RATE_PRESETS = [0.5, 1, 1.5, 2, 2.5, 3]
const MIN_RATE = 0.5
const MAX_RATE = 3
const RATE_STEP = 0.1
const DEFAULT_WORDS_PER_SECOND = 3

function clampRate(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(value * 100) / 100))
}

function formatRate(rate: number) {
  const decimals = Number.isInteger(rate) ? 0 : 2
  return `${rate.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: 2 })}×`
}

function formatRateInput(rate: number) {
  return String(Math.round(rate * 100) / 100)
}

function parseRateInput(value: string) {
  return Number(value.trim().replace(',', '.'))
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const rounded = Math.round(seconds)
  const minutes = Math.floor(rounded / 60)
  const remainder = rounded % 60
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

function wordStarts(text: string) {
  return Array.from(text.matchAll(/\S+/g), (match) => match.index ?? 0)
}

function languageName(lang: string) {
  const known: Record<string, string> = {
    'pt-BR': 'Português (Brasil)',
    'en-US': 'Inglês (Estados Unidos)',
    'en-GB': 'Inglês (Reino Unido)',
    'ja-JP': 'Japonês',
    'zh-CN': 'Chinês (Simplificado)',
  }
  return known[lang] ?? lang
}

function currentWordIndex(starts: number[], currentChar: number) {
  let index = 0
  for (let cursor = 0; cursor < starts.length; cursor += 1) {
    if (starts[cursor] > currentChar) break
    index = cursor
  }
  return index
}

export default function SynopsisAudioPlayer({ text, lang, languageLabel, onClose }: SynopsisAudioPlayerProps) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const synth = supported ? window.speechSynthesis : null
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [status, setStatus] = useState<PlaybackStatus>('idle')
  const [currentChar, setCurrentChar] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [error, setError] = useState('')
  const [rate, setRate] = useState(() => clampRate(Number(localStorage.getItem('animefinder.tts.rate') || 1)))
  const [rateDraft, setRateDraft] = useState(() => formatRateInput(clampRate(Number(localStorage.getItem('animefinder.tts.rate') || 1))))
  const [pitch, setPitch] = useState(() => Number(localStorage.getItem('animefinder.tts.pitch') || 1))
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('animefinder.tts.volume') || 1))
  const [voiceUri, setVoiceUri] = useState('')
  const generationRef = useRef(0)

  const starts = useMemo(() => wordStarts(text), [text])
  const languageVoices = useMemo(() => {
    const prefix = lang.toLowerCase().split('-')[0]
    const matching = voices.filter((voice) => voice.lang.toLowerCase().startsWith(prefix))
    return matching.length ? matching : voices
  }, [voices, lang])

  const selectedVoice = useMemo(
    () => languageVoices.find((voice) => voice.voiceURI === voiceUri) ?? null,
    [languageVoices, voiceUri],
  )

  useEffect(() => {
    if (!synth) return
    const refreshVoices = () => setVoices(synth.getVoices())
    refreshVoices()
    synth.addEventListener('voiceschanged', refreshVoices)
    return () => synth.removeEventListener('voiceschanged', refreshVoices)
  }, [synth])

  useEffect(() => {
    const saved = localStorage.getItem(`animefinder.tts.voice.${lang}`)
    const preferred = languageVoices.find((voice) => voice.voiceURI === saved)
      ?? languageVoices.find((voice) => voice.default)
      ?? languageVoices[0]
    setVoiceUri(preferred?.voiceURI ?? '')
  }, [lang, languageVoices])

  useEffect(() => {
    return () => {
      generationRef.current += 1
      synth?.cancel()
    }
  }, [synth])

  useEffect(() => {
    generationRef.current += 1
    synth?.cancel()
    setStatus('idle')
    setCurrentChar(0)
    setError('')
  }, [text, lang, synth])

  const totalSeconds = useMemo(() => {
    const words = Math.max(starts.length, 1)
    return words / (DEFAULT_WORDS_PER_SECOND * rate)
  }, [starts.length, rate])

  const elapsedSeconds = text.length > 0 ? totalSeconds * Math.min(currentChar / text.length, 1) : 0
  const progress = text.length > 0 ? Math.min((currentChar / text.length) * 100, 100) : 0

  function stop(reset = true) {
    generationRef.current += 1
    synth?.cancel()
    setStatus('idle')
    if (reset) setCurrentChar(0)
  }

  function speakFrom(charIndex: number, overrides: SpeechOverrides = {}) {
    if (!synth || !text.trim()) return

    const safeStart = Math.max(0, Math.min(charIndex, text.length - 1))
    generationRef.current += 1
    const generation = generationRef.current
    synth.cancel()

    const utterance = new SpeechSynthesisUtterance(text.slice(safeStart))
    utterance.lang = lang
    utterance.rate = overrides.rate ?? rate
    utterance.pitch = overrides.pitch ?? pitch
    utterance.volume = overrides.volume ?? volume
    const voice = overrides.voice !== undefined ? overrides.voice : selectedVoice
    if (voice) utterance.voice = voice

    setCurrentChar(safeStart)
    setError('')

    utterance.onstart = () => {
      if (generation !== generationRef.current) return
      setStatus('playing')
    }

    utterance.onboundary = (event) => {
      if (generation !== generationRef.current) return
      setCurrentChar(Math.min(safeStart + event.charIndex, text.length))
    }

    utterance.onend = () => {
      if (generation !== generationRef.current) return
      setCurrentChar(text.length)
      setStatus('idle')
    }

    utterance.onerror = (event) => {
      if (generation !== generationRef.current) return
      if (event.error === 'canceled' || event.error === 'interrupted') return
      setStatus('idle')
      setError('Não foi possível reproduzir esta voz no navegador.')
    }

    synth.speak(utterance)
  }

  function togglePlayback() {
    if (!synth) return
    if (status === 'playing') {
      synth.pause()
      setStatus('paused')
      return
    }
    if (status === 'paused' && synth.speaking) {
      synth.resume()
      setStatus('playing')
      return
    }
    speakFrom(currentChar >= text.length - 1 ? 0 : currentChar)
  }

  function seekToChar(targetChar: number) {
    if (!text.length) return
    const safe = Math.max(0, Math.min(targetChar, text.length - 1))
    setCurrentChar(safe)
    if (status !== 'idle') speakFrom(safe)
  }

  function seekSeconds(seconds: number) {
    if (!starts.length) return
    const currentWord = currentWordIndex(starts, currentChar)
    const wordsToMove = Math.max(1, Math.round(Math.abs(seconds) * DEFAULT_WORDS_PER_SECOND * rate))
    const targetWord = seconds < 0
      ? Math.max(0, currentWord - wordsToMove)
      : Math.min(starts.length - 1, currentWord + wordsToMove)
    seekToChar(starts[targetWord] ?? 0)
  }

  function changeRate(nextRate: number) {
    const safeRate = clampRate(nextRate)
    setRate(safeRate)
    setRateDraft(formatRateInput(safeRate))
    localStorage.setItem('animefinder.tts.rate', String(safeRate))
    if (status !== 'idle') speakFrom(currentChar, { rate: safeRate })
  }

  function commitRateDraft() {
    const parsed = parseRateInput(rateDraft)
    if (!Number.isFinite(parsed)) {
      setRateDraft(formatRateInput(rate))
      return
    }
    changeRate(parsed)
  }

  function stepRate(delta: number) {
    changeRate(Math.round((rate + delta) * 10) / 10)
  }

  function changeVoice(nextVoiceUri: string) {
    const nextVoice = languageVoices.find((voice) => voice.voiceURI === nextVoiceUri) ?? null
    setVoiceUri(nextVoiceUri)
    localStorage.setItem(`animefinder.tts.voice.${lang}`, nextVoiceUri)
    if (status !== 'idle') speakFrom(currentChar, { voice: nextVoice })
  }

  function changePitch(nextPitch: number) {
    setPitch(nextPitch)
    localStorage.setItem('animefinder.tts.pitch', String(nextPitch))
    if (status !== 'idle') speakFrom(currentChar, { pitch: nextPitch })
  }

  function changeVolume(nextVolume: number) {
    setVolume(nextVolume)
    localStorage.setItem('animefinder.tts.volume', String(nextVolume))
    if (status !== 'idle') speakFrom(currentChar, { volume: nextVolume })
  }

  function closePlayer() {
    stop(true)
    onClose()
  }

  const rateStepper = (compact = false) => (
    <div className={compact ? 'audio-rate-stepper compact' : 'audio-rate-stepper'}>
      <button
        type="button"
        onClick={() => stepRate(-RATE_STEP)}
        disabled={rate <= MIN_RATE}
        aria-label="Diminuir velocidade em 0,1"
      >−</button>
      <div className="audio-rate-input-wrap">
        <input
          type="text"
          inputMode="decimal"
          list="animefinder-rate-presets"
          value={rateDraft}
          onChange={(event) => setRateDraft(event.target.value)}
          onBlur={commitRateDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitRateDraft()
              event.currentTarget.blur()
            }
          }}
          aria-label="Velocidade da narração"
        />
        <span>×</span>
      </div>
      <button
        type="button"
        onClick={() => stepRate(RATE_STEP)}
        disabled={rate >= MAX_RATE}
        aria-label="Aumentar velocidade em 0,1"
      >+</button>
      <datalist id="animefinder-rate-presets">
        {RATE_PRESETS.map((preset) => <option key={preset} value={preset}>{formatRate(preset)}</option>)}
      </datalist>
    </div>
  )

  if (!supported) {
    return (
      <div className="synopsis-audio-player unsupported">
        <span>Seu navegador não oferece narração por voz para esta sinopse.</span>
        <button onClick={onClose}>Fechar</button>
      </div>
    )
  }

  return (
    <div className="synopsis-audio-player" aria-label="Player de áudio da sinopse">
      <div className="audio-player-topline">
        <div className="audio-now-playing">
          <span className={`audio-pulse ${status === 'playing' ? 'active' : ''}`} aria-hidden="true" />
          <div>
            <strong>{status === 'playing' ? 'Narrando sinopse' : status === 'paused' ? 'Narração pausada' : 'Ouvir sinopse'}</strong>
            <small>{languageLabel} · {selectedVoice?.name ?? 'Voz padrão do sistema'}</small>
          </div>
        </div>
        <button className="audio-close-button" onClick={closePlayer} aria-label="Fechar player">×</button>
      </div>

      <div className="audio-progress-row">
        <span>~{formatTime(elapsedSeconds)}</span>
        <input
          className="audio-progress"
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={progress}
          onChange={(event) => seekToChar(Math.floor((Number(event.target.value) / 100) * text.length))}
          aria-label="Posição aproximada da narração"
        />
        <span>~{formatTime(totalSeconds)}</span>
      </div>

      <div className="audio-controls">
        <button className="audio-seek-button" onClick={() => seekSeconds(-10)} aria-label="Voltar aproximadamente 10 segundos">↶ <span>10s</span></button>
        <button className="audio-play-button" onClick={togglePlayback} aria-label={status === 'playing' ? 'Pausar' : 'Reproduzir'}>
          {status === 'playing' ? 'Ⅱ' : '▶'}
        </button>
        <button className="audio-seek-button" onClick={() => seekSeconds(10)} aria-label="Avançar aproximadamente 10 segundos"><span>10s</span> ↷</button>

        <div className="audio-rate-control">
          <span>Velocidade</span>
          {rateStepper(true)}
        </div>

        <div className="audio-settings-wrap">
          <button
            className={settingsOpen ? 'audio-settings-button active' : 'audio-settings-button'}
            onClick={() => setSettingsOpen((value) => !value)}
            aria-expanded={settingsOpen}
            aria-label="Configurações da narração"
          >⚙</button>
          {settingsOpen && (
            <div className="audio-settings-popover">
              <div className="audio-settings-heading">
                <strong>Configurações de narração</strong>
                <small>Preferências salvas neste navegador</small>
              </div>

              <div className="audio-setting-info">
                <span>Idioma</span>
                <strong>{languageName(lang)}</strong>
                <small>Automático conforme a sinopse exibida</small>
              </div>

              <label className="audio-setting-field">
                <span>Narrador</span>
                <select value={voiceUri} onChange={(event) => changeVoice(event.target.value)}>
                  {languageVoices.length === 0 && <option value="">Voz padrão do sistema</option>}
                  {languageVoices.map((voice) => (
                    <option key={voice.voiceURI} value={voice.voiceURI}>
                      {voice.name} · {voice.lang}{voice.localService ? ' · local' : ' · online'}
                    </option>
                  ))}
                </select>
              </label>

              <div className="audio-setting-field">
                <span>Velocidade</span>
                {rateStepper()}
                <small>Digite um valor entre 0,5× e 3× ou use −/+ em passos de 0,1.</small>
              </div>

              <label className="audio-setting-slider">
                <span><b>Tom da voz</b><strong>{pitch.toFixed(1)}</strong></span>
                <input type="range" min="0.5" max="2" step="0.1" value={pitch} onChange={(event) => changePitch(Number(event.target.value))} />
              </label>

              <label className="audio-setting-slider">
                <span><b>Volume</b><strong>{Math.round(volume * 100)}%</strong></span>
                <input type="range" min="0" max="1" step="0.1" value={volume} onChange={(event) => changeVolume(Number(event.target.value))} />
              </label>

              <div className="audio-setting-info compact">
                <span>Mecanismo</span>
                <strong>Web Speech · navegador</strong>
                <small>{selectedVoice ? `${selectedVoice.localService ? 'Voz instalada/local' : 'Voz fornecida pelo navegador'}${selectedVoice.default ? ' · padrão do sistema' : ''}` : 'Seleção automática de voz'}</small>
              </div>
            </div>
          )}
        </div>
      </div>

      {error && <div className="audio-player-error">{error}</div>}
      <div className="audio-time-note">Os tempos e saltos de 10 s são aproximados porque a narração é sintetizada em tempo real pelo navegador.</div>
    </div>
  )
}
