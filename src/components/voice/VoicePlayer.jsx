import { useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { formatDuration, playbackFraction } from '../../lib/voiceFormat'
import { tr } from '../../i18n'

// Only one voice message plays at a time: starting one pauses the previous.
let current = null

/**
 * Plays one voice message: play / pause / resume / replay, a position slider and "0:03 / 0:07". `durationMs` is the length stored when it was
 * recorded (recorded WebM files do not report their own length). `src` may be a signed link or a local object URL; with no `src` the button waits.
 */
export default function VoicePlayer({ src, durationMs, onBroken, light = false, label }) {
  const audio = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [sec, setSec] = useState(0)
  const [ended, setEnded] = useState(false)
  const [failed, setFailed] = useState(false)
  const total = durationMs > 0 ? durationMs : (audio.current && Number.isFinite(audio.current.duration) ? audio.current.duration * 1000 : 0)
  const fraction = playbackFraction(sec, durationMs, audio.current && audio.current.duration)

  useEffect(() => { setPlaying(false); setSec(0); setEnded(false); setFailed(false) }, [src])
  useEffect(() => () => { const a = audio.current; if (a) { a.pause(); if (current === a) current = null } }, [])

  const toggle = async () => {
    const a = audio.current
    if (!a || !src) return
    if (playing) { a.pause(); return }
    if (current && current !== a) current.pause()
    current = a
    if (ended) { a.currentTime = 0; setEnded(false) }
    try { await a.play(); setFailed(false) } catch { setFailed(true) }
  }
  const seek = (e) => { const a = audio.current; if (!a) return; const t = (Number(e.target.value) / 1000) * (total / 1000); a.currentTime = t; setSec(t); setEnded(false) }
  const Icon = playing ? Pause : ended ? RotateCcw : Play
  const name = playing ? tr('Pause') : ended ? tr('Play again') : tr('Play')
  const tone = light ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-brand-600 text-white hover:bg-brand-700'

  return (
    <div className="flex w-64 max-w-full items-center gap-2">
      <audio ref={audio} src={src || undefined} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setEnded(true); setSec(0) }}
        onTimeUpdate={(e) => setSec(e.currentTarget.currentTime)} onError={() => { setFailed(true); setPlaying(false); if (onBroken) onBroken() }} />
      <button type="button" disabled={!src} onClick={toggle} aria-label={label ? `${name}: ${label}` : name} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50 ${tone}`}><Icon size={20} aria-hidden="true" /></button>
      <div className="min-w-0 flex-1">
        <input type="range" min={0} max={1000} step={1} value={Math.round(fraction * 1000)} onChange={seek} disabled={!src || !total} aria-label={tr('Playback position')} aria-valuetext={`${formatDuration(sec * 1000)} / ${formatDuration(total)}`} className="h-2 w-full cursor-pointer accent-current" />
        <div className="flex justify-between text-[11px] tabular-nums opacity-80"><span>{formatDuration(sec * 1000)}</span><span>{formatDuration(total)}</span></div>
        {failed && <p role="alert" className="text-[11px] text-red-300 dark:text-red-400">{tr('This voice message could not be played.')}</p>}
      </div>
    </div>
  )
}
