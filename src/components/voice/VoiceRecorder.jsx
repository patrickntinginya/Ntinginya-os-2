import { useEffect, useMemo, useRef, useState } from 'react'
import { Mic, RotateCcw, Send, Square, Trash2, X } from 'lucide-react'
import VoicePlayer from './VoicePlayer'
import { createVoiceRecorder, VOICE_ERRORS } from '../../lib/voiceRecorder'
import { createHoldGesture } from '../../lib/holdGesture'
import { VOICE, formatDuration, voiceFileName } from '../../lib/voiceFormat'
import { tr } from '../../i18n'

/**
 * Voice recording for chat, posts and comments.
 *   HOLD the microphone and speak, release to preview  |  slide left and release to cancel  |  quick TAP to start, tap Stop to finish
 *   (the tap mode also works with a keyboard or a screen reader: Enter / Space start and stop, Escape cancels).
 * After recording there is always a PREVIEW: listen, delete, record again, or send. The microphone is released as soon as recording ends.
 * `onSend({ file, durationMs })` receives the finished recording; uploading and progress belong to the caller.
 * `onActiveChange(true)` tells the parent to hide its own controls while recording / previewing.
 */
export default function VoiceRecorder({ onSend, onActiveChange, disabled = false, size = 'md' }) {
  const [st, setSt] = useState({ status: 'idle', error: null, elapsedMs: 0, result: null })
  const [latched, setLatched] = useState(false)
  const [slide, setSlide] = useState(false)
  const rec = useMemo(() => createVoiceRecorder({ onChange: setSt }), [])
  const gesture = useRef(createHoldGesture())
  const [url, setUrl] = useState(null)

  useEffect(() => () => rec.dispose(), [rec])
  useEffect(() => {
    if (st.result && st.result.blob) { const u = URL.createObjectURL(st.result.blob); setUrl(u); return () => URL.revokeObjectURL(u) }
    setUrl(null); return undefined
  }, [st.result])
  const active = st.status === 'requesting' || st.status === 'recording' || st.status === 'recorded'
  useEffect(() => { if (onActiveChange) onActiveChange(active) }, [active, onActiveChange])

  const down = (e) => {
    if (disabled || st.status === 'recorded') return
    e.preventDefault()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not all WebViews support capture */ }
    if (st.status === 'recording') return // a latched recording: the Stop button handles it
    setLatched(false); setSlide(false)
    gesture.current.start(e.clientX); rec.start()
  }
  const move = (e) => { if (gesture.current.active()) setSlide(gesture.current.wouldCancel(e.clientX)) }
  const up = (e) => {
    if (!gesture.current.active()) return
    const act = gesture.current.end(e.clientX); setSlide(false)
    const s = rec.state().status
    if (act === 'cancel') { rec.cancel(); setLatched(false) }
    else if (act === 'stop' && s === 'recording') rec.stop()
    else setLatched(true) // a tap, or released while the permission prompt was open: keep recording until Stop
  }
  const cancelGesture = () => { // the browser took the touch (permission prompt, system gesture)
    if (!gesture.current.active()) return
    gesture.current.abort(); setSlide(false)
    if (rec.state().status === 'recording') rec.stop(); else setLatched(true)
  }
  const key = (e) => {
    if (e.key === 'Escape') { rec.cancel(); setLatched(false); return }
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
      e.preventDefault()
      if (st.status === 'recording') rec.stop(); else if (st.status === 'idle' || st.status === 'error') { rec.dismissError(); setLatched(true); rec.start() }
    }
  }
  const send = () => {
    if (!st.result) return
    const { blob, durationMs, mime } = st.result
    const file = new File([blob], voiceFileName(mime), { type: mime })
    rec.discard(); setLatched(false)
    onSend({ file, durationMs })
  }
  const rerecord = () => { rec.discard(); setLatched(true); rec.start() } // the click is the user gesture; the microphone permission was already given
  const btn = size === 'lg' ? 'h-12 w-12' : 'h-11 w-11'

  return (
    <div className={`flex min-w-0 items-center gap-2 ${active ? 'flex-1' : ''}`}>
      {st.status === 'error' && (
        <p role="alert" className="min-w-0 flex-1 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-500/10 dark:text-red-200">
          {tr(VOICE_ERRORS[st.error] || VOICE_ERRORS.failed)} <button type="button" className="underline" onClick={() => rec.dismissError()}>{tr('Dismiss')}</button>
        </p>
      )}
      {st.status === 'requesting' && <p role="status" className="min-w-0 flex-1 text-sm text-slate-600 dark:text-slate-300">{tr('Waiting for microphone permission…')}</p>}
      {st.status === 'recording' && (
        <div className="flex min-w-0 flex-1 items-center gap-2" role="status" aria-live="polite">
          <span className="h-3 w-3 shrink-0 animate-pulse rounded-full bg-red-600" aria-hidden="true" />
          <span className="tabular-nums text-sm font-semibold">{formatDuration(st.elapsedMs)} / {formatDuration(VOICE.maxMs)}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{slide ? tr('Release to cancel') : latched ? tr('Recording… tap Stop when you are done.') : tr('Recording… release to preview, slide left to cancel.')}</span>
          {latched && <button type="button" onClick={() => { rec.cancel(); setLatched(false) }} className="icon-btn" aria-label={tr('Cancel recording')}><X size={20} /></button>}
          {latched && <button type="button" onClick={() => rec.stop()} className="flex h-11 w-11 items-center justify-center rounded-full bg-red-600 text-white" aria-label={tr('Stop recording')}><Square size={18} aria-hidden="true" /></button>}
        </div>
      )}
      {st.status === 'recorded' && st.result && (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 rounded-2xl bg-slate-100 p-2 dark:bg-white/10">
          <VoicePlayer src={url} durationMs={st.result.durationMs} label={tr('Preview')} />
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => { rec.discard(); setLatched(false) }} className="icon-btn" aria-label={tr('Delete recording')}><Trash2 size={20} /></button>
            <button type="button" onClick={rerecord} className="icon-btn" aria-label={tr('Record again')}><RotateCcw size={20} /></button>
            <button type="button" onClick={send} className={`flex ${btn} items-center justify-center rounded-full bg-brand-600 text-white`} aria-label={tr('Send voice message')}><Send size={18} aria-hidden="true" /></button>
          </div>
        </div>
      )}
      {(st.status === 'idle' || st.status === 'error' || st.status === 'requesting' || (st.status === 'recording' && !latched)) && (
        <button type="button" disabled={disabled} aria-label={tr('Hold to record a voice message')} aria-pressed={st.status === 'recording'}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancelGesture} onKeyDown={key} onContextMenu={(e) => e.preventDefault()}
          style={{ touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
          className={`flex ${btn} shrink-0 items-center justify-center rounded-full ${st.status === 'recording' ? 'scale-110 bg-red-600 text-white' : 'bg-slate-200 text-slate-800 dark:bg-white/15 dark:text-white'} disabled:opacity-50`}>
          <Mic size={20} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
