import { useEffect, useMemo, useRef, useState } from 'react'

type PlaybackStatus='idle'|'playing'|'paused'
type SynopsisAudioPlayerProps={text:string;lang:string;languageLabel:string;onClose:()=>void}
type SpeechOverrides={rate?:number;pitch?:number;volume?:number;voice?:SpeechSynthesisVoice|null}
const RATE_PRESETS=[0.5,1,1.5,2,2.5,3],MIN_RATE=.5,MAX_RATE=3,RATE_STEP=.1,DEFAULT_WORDS_PER_SECOND=3
const clampRate=(v:number)=>Number.isFinite(v)?Math.min(MAX_RATE,Math.max(MIN_RATE,Math.round(v*100)/100)):1
const formatRate=(r:number)=>`${r.toLocaleString('pt-BR',{minimumFractionDigits:Number.isInteger(r)?0:2,maximumFractionDigits:2})}×`
const formatRateInput=(r:number)=>String(Math.round(r*100)/100)
const parseRateInput=(v:string)=>Number(v.trim().replace(',','.'))
function formatTime(seconds:number){if(!Number.isFinite(seconds)||seconds<0)return'0:00';const rounded=Math.round(seconds),m=Math.floor(rounded/60);return`${m}:${String(rounded%60).padStart(2,'0')}`}
const wordStarts=(text:string)=>Array.from(text.matchAll(/\S+/g),(match)=>match.index ?? 0)
function languageName(lang:string){const known:Record<string,string>={'pt-BR':'Português (Brasil)','en-US':'Inglês (Estados Unidos)','en-GB':'Inglês (Reino Unido)','ja-JP':'Japonês','zh-CN':'Chinês (Simplificado)'};return known[lang] ?? lang}
function currentWordIndex(starts:number[],char:number){let index=0;for(let cursor=0;cursor<starts.length;cursor+=1){if(starts[cursor]>char)break;index=cursor}return index}

export default function SynopsisAudioPlayer({text,lang,languageLabel,onClose}:SynopsisAudioPlayerProps){
  const supported=typeof window!=='undefined'&&'speechSynthesis'in window,synth=supported?window.speechSynthesis:null
  const [voices,setVoices]=useState<SpeechSynthesisVoice[]>([]),[status,setStatus]=useState<PlaybackStatus>('idle'),[currentChar,setCurrentChar]=useState(0),[displayChar,setDisplayChar]=useState(0)
  const [settingsOpen,setSettingsOpen]=useState(false),[error,setError]=useState('')
  const [rate,setRate]=useState(()=>clampRate(Number(localStorage.getItem('animefinder.tts.rate')||1))),[rateDraft,setRateDraft]=useState(()=>formatRateInput(clampRate(Number(localStorage.getItem('animefinder.tts.rate')||1))))
  const [pitch,setPitch]=useState(()=>Number(localStorage.getItem('animefinder.tts.pitch')||1)),[volume,setVolume]=useState(()=>Number(localStorage.getItem('animefinder.tts.volume')||1)),[voiceUri,setVoiceUri]=useState('')
  const generationRef=useRef(0),anchorRef=useRef({char:0,at:0}),cpsRef=useRef(12),rafRef=useRef<number|null>(null)
  const starts=useMemo(()=>wordStarts(text),[text])
  const languageVoices=useMemo(()=>{const prefix=lang.toLowerCase().split('-')[0],matching=voices.filter((voice)=>voice.lang.toLowerCase().startsWith(prefix));return matching.length?matching:voices},[voices,lang])
  const selectedVoice=useMemo(()=>languageVoices.find((voice)=>voice.voiceURI===voiceUri)??null,[languageVoices,voiceUri])

  const baselineTotalSeconds=useMemo(()=>Math.max(starts.length,1)/(DEFAULT_WORDS_PER_SECOND*rate),[starts.length,rate])
  useEffect(()=>{cpsRef.current=Math.max(text.length/Math.max(baselineTotalSeconds,1),2)},[text.length,baselineTotalSeconds])

  useEffect(()=>{if(!synth)return;const refresh=()=>setVoices(synth.getVoices());refresh();synth.addEventListener('voiceschanged',refresh);return()=>synth.removeEventListener('voiceschanged',refresh)},[synth])
  useEffect(()=>{const saved=localStorage.getItem(`animefinder.tts.voice.${lang}`),preferred=languageVoices.find((voice)=>voice.voiceURI===saved)??languageVoices.find((voice)=>voice.default)??languageVoices[0];setVoiceUri(preferred?.voiceURI??'')},[lang,languageVoices])
  useEffect(()=>()=>{generationRef.current+=1;if(rafRef.current!=null)cancelAnimationFrame(rafRef.current);synth?.cancel()},[synth])
  useEffect(()=>{generationRef.current+=1;synth?.cancel();setStatus('idle');setCurrentChar(0);setDisplayChar(0);setError('');anchorRef.current={char:0,at:performance.now()}},[text,lang,synth])

  // SpeechSynthesis has no reliable currentTime. Visual progress is therefore anchored to
  // real boundary callbacks and interpolated only between the latest observed boundary and
  // the next callback using a measured/estimated character rate. Every new boundary snaps
  // the indicator back to the browser's actual narration position.
  useEffect(()=>{
    if(status!=='playing'){if(rafRef.current!=null){cancelAnimationFrame(rafRef.current);rafRef.current=null}return}
    const tick=(now:number)=>{const anchor=anchorRef.current,estimated=anchor.char+((now-anchor.at)/1000)*cpsRef.current;setDisplayChar(Math.min(text.length,Math.max(anchor.char,estimated)));rafRef.current=requestAnimationFrame(tick)}
    rafRef.current=requestAnimationFrame(tick);return()=>{if(rafRef.current!=null)cancelAnimationFrame(rafRef.current);rafRef.current=null}
  },[status,text.length])

  const effectiveChar=Math.min(text.length,Math.max(currentChar,displayChar)),progress=text.length?Math.min(effectiveChar/text.length*100,100):0
  const estimatedTotalSeconds=Math.max(text.length/Math.max(cpsRef.current,1),baselineTotalSeconds*.65)
  const elapsedSeconds=estimatedTotalSeconds*(text.length?effectiveChar/text.length:0)

  function stop(reset=true){generationRef.current+=1;synth?.cancel();setStatus('idle');if(reset){setCurrentChar(0);setDisplayChar(0)} }
  function speakFrom(charIndex:number,overrides:SpeechOverrides={}){
    if(!synth||!text.trim())return
    const safeStart=Math.max(0,Math.min(charIndex,text.length-1));generationRef.current+=1;const generation=generationRef.current;synth.cancel()
    const utterance=new SpeechSynthesisUtterance(text.slice(safeStart));utterance.lang=lang;utterance.rate=overrides.rate??rate;utterance.pitch=overrides.pitch??pitch;utterance.volume=overrides.volume??volume;const voice=overrides.voice!==undefined?overrides.voice:selectedVoice;if(voice)utterance.voice=voice
    setCurrentChar(safeStart);setDisplayChar(safeStart);anchorRef.current={char:safeStart,at:performance.now()};setError('')
    utterance.onstart=()=>{if(generation!==generationRef.current)return;anchorRef.current={char:safeStart,at:performance.now()};setStatus('playing')}
    utterance.onboundary=(event)=>{if(generation!==generationRef.current)return;const next=Math.min(safeStart+event.charIndex,text.length),now=performance.now(),previous=anchorRef.current,deltaChar=next-previous.char,deltaSec=(now-previous.at)/1000;if(deltaChar>0&&deltaSec>.08){const observed=deltaChar/deltaSec;cpsRef.current=cpsRef.current*.65+observed*.35}anchorRef.current={char:next,at:now};setCurrentChar(next);setDisplayChar(next)}
    utterance.onend=()=>{if(generation!==generationRef.current)return;setCurrentChar(text.length);setDisplayChar(text.length);setStatus('idle')}
    utterance.onerror=(event)=>{if(generation!==generationRef.current||event.error==='canceled'||event.error==='interrupted')return;setStatus('idle');setError('Não foi possível reproduzir esta voz no navegador.')}
    synth.speak(utterance)
  }
  function togglePlayback(){if(!synth)return;if(status==='playing'){synth.pause();setCurrentChar(Math.floor(effectiveChar));setDisplayChar(Math.floor(effectiveChar));setStatus('paused');return}if(status==='paused'&&synth.speaking){anchorRef.current={char:Math.floor(effectiveChar),at:performance.now()};synth.resume();setStatus('playing');return}speakFrom(effectiveChar>=text.length-1?0:Math.floor(effectiveChar))}
  function seekToChar(target:number){if(!text.length)return;const safe=Math.max(0,Math.min(target,text.length-1));setCurrentChar(safe);setDisplayChar(safe);anchorRef.current={char:safe,at:performance.now()};if(status!=='idle')speakFrom(safe)}
  function seekSeconds(seconds:number){if(!starts.length)return;const word=currentWordIndex(starts,effectiveChar),move=Math.max(1,Math.round(Math.abs(seconds)*DEFAULT_WORDS_PER_SECOND*rate)),target=seconds<0?Math.max(0,word-move):Math.min(starts.length-1,word+move);seekToChar(starts[target]??0)}
  function changeRate(next:number){const safe=clampRate(next);setRate(safe);setRateDraft(formatRateInput(safe));localStorage.setItem('animefinder.tts.rate',String(safe));if(status!=='idle')speakFrom(Math.floor(effectiveChar),{rate:safe})}
  function commitRateDraft(){const parsed=parseRateInput(rateDraft);if(!Number.isFinite(parsed)){setRateDraft(formatRateInput(rate));return}changeRate(parsed)}
  const stepRate=(delta:number)=>changeRate(Math.round((rate+delta)*10)/10)
  function changeVoice(uri:string){const voice=languageVoices.find((v)=>v.voiceURI===uri)??null;setVoiceUri(uri);localStorage.setItem(`animefinder.tts.voice.${lang}`,uri);if(status!=='idle')speakFrom(Math.floor(effectiveChar),{voice})}
  function changePitch(value:number){setPitch(value);localStorage.setItem('animefinder.tts.pitch',String(value));if(status!=='idle')speakFrom(Math.floor(effectiveChar),{pitch:value})}
  function changeVolume(value:number){setVolume(value);localStorage.setItem('animefinder.tts.volume',String(value));if(status!=='idle')speakFrom(Math.floor(effectiveChar),{volume:value})}
  function closePlayer(){stop(true);onClose()}

  const rateStepper=(compact=false)=><div className={compact?'audio-rate-stepper compact':'audio-rate-stepper'}><button type="button" onClick={()=>stepRate(-RATE_STEP)} disabled={rate<=MIN_RATE}>−</button><div className="audio-rate-input-wrap"><input type="text" inputMode="decimal" list="animefinder-rate-presets" value={rateDraft} onChange={(e)=>setRateDraft(e.target.value)} onBlur={commitRateDraft} onKeyDown={(e)=>{if(e.key==='Enter'){commitRateDraft();e.currentTarget.blur()}}}/><span>×</span></div><button type="button" onClick={()=>stepRate(RATE_STEP)} disabled={rate>=MAX_RATE}>+</button><datalist id="animefinder-rate-presets">{RATE_PRESETS.map((preset)=><option key={preset} value={preset}>{formatRate(preset)}</option>)}</datalist></div>

  if(!supported)return <div className="synopsis-audio-player unsupported"><span>Seu navegador não oferece narração por voz para esta sinopse.</span><button onClick={onClose}>Fechar</button></div>
  return <div className="synopsis-audio-player" aria-label="Player de áudio da sinopse">
    <div className="audio-player-topline"><div className="audio-now-playing"><span className={`audio-pulse ${status==='playing'?'active':''}`}/><div><strong>{status==='playing'?'Narrando sinopse':status==='paused'?'Narração pausada':'Ouvir sinopse'}</strong><small>{languageLabel} · {selectedVoice?.name ?? 'Voz padrão do sistema'}</small></div></div><button className="audio-close-button" onClick={closePlayer}>×</button></div>
    <div className="audio-progress-row"><span>~{formatTime(elapsedSeconds)}</span><input className="audio-progress" type="range" min="0" max="100" step="0.1" value={progress} onChange={(e)=>seekToChar(Math.floor(Number(e.target.value)/100*text.length))} aria-label="Posição aproximada da narração"/><span>~{formatTime(estimatedTotalSeconds)}</span></div>
    <div className="audio-controls"><button className="audio-seek-button" onClick={()=>seekSeconds(-10)}>↶ <span>10s</span></button><button className="audio-play-button" onClick={togglePlayback}>{status==='playing'?'Ⅱ':'▶'}</button><button className="audio-seek-button" onClick={()=>seekSeconds(10)}><span>10s</span> ↷</button><div className="audio-rate-control"><span>Velocidade</span>{rateStepper(true)}</div><div className="audio-settings-wrap"><button className={settingsOpen?'audio-settings-button active':'audio-settings-button'} onClick={()=>setSettingsOpen((v)=>!v)}>⚙</button>{settingsOpen&&<div className="audio-settings-popover"><div className="audio-settings-heading"><strong>Configurações de narração</strong><small>Preferências deste navegador</small></div><div className="audio-setting-info"><span>Idioma</span><strong>{languageName(lang)}</strong><small>Automático conforme a sinopse exibida</small></div><label className="audio-setting-field"><span>Narrador</span><select value={voiceUri} onChange={(e)=>changeVoice(e.target.value)}>{languageVoices.length===0&&<option value="">Voz padrão do sistema</option>}{languageVoices.map((voice)=><option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}{voice.localService?' · local':' · online'}</option>)}</select></label><div className="audio-setting-field"><span>Velocidade</span>{rateStepper()}<small>0,5× a 3×.</small></div><label className="audio-setting-slider"><span><b>Tom da voz</b><strong>{pitch.toFixed(1)}</strong></span><input type="range" min="0.5" max="2" step="0.1" value={pitch} onChange={(e)=>changePitch(Number(e.target.value))}/></label><label className="audio-setting-slider"><span><b>Volume</b><strong>{Math.round(volume*100)}%</strong></span><input type="range" min="0" max="1" step="0.1" value={volume} onChange={(e)=>changeVolume(Number(e.target.value))}/></label><div className="audio-setting-info compact"><span>Mecanismo</span><strong>Web Speech · navegador</strong><small>{selectedVoice?`${selectedVoice.localService?'Voz instalada/local':'Voz fornecida pelo navegador'}${selectedVoice.default?' · padrão do sistema':''}`:'Seleção automática de voz'}</small></div></div>}</div></div>
    {error&&<div className="audio-player-error">{error}</div>}<div className="audio-time-note">O progresso é aproximado: ele é ancorado nos eventos reais de boundary do SpeechSynthesis e interpolado entre esses eventos. Cada boundary corrige a posição visual.</div>
  </div>
}
