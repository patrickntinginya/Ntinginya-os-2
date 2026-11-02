// Microphone recording as a small state machine, with every browser API INJECTED so it is unit-tested with fakes.
//   idle -> requesting (asking for the microphone) -> recording -> recorded (preview) -> idle (sent / deleted)
//   any step can end in error: unsupported | insecure | permission_denied | no_device | busy | too_short | too_big | format | failed
// The microphone is released the moment recording ends, is cancelled, fails, or the recorder is disposed. Nothing is recorded in the background.
import { VOICE, baseMime, pickVoiceFormat, VOICE_BASES } from './voiceFormat.js'

export const VOICE_ERRORS = {
  unsupported: 'This device cannot record audio here.',
  insecure: 'Recording needs a secure (https) connection.',
  permission_denied: 'Microphone access is blocked. Allow the microphone for this app in your browser or phone settings, then try again.',
  no_device: 'No microphone was found on this device.',
  busy: 'The microphone is being used by another app.',
  too_short: 'That recording is too short. Hold the button while you speak.',
  too_big: 'That voice message is larger than 5 MB.',
  format: 'This device recorded in a format that cannot be sent.',
  failed: 'Recording failed. Please try again.',
}

export function classifyMicError(e) {
  const name = String((e && e.name) || '')
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'permission_denied'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'no_device'
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy'
  return 'failed'
}

export function createVoiceRecorder({
  nav = typeof navigator === 'undefined' ? null : navigator,
  Rec = typeof MediaRecorder === 'undefined' ? null : MediaRecorder,
  secure = typeof isSecureContext === 'undefined' ? true : isSecureContext,
  now = () => Date.now(), setTick = (f, ms) => setInterval(f, ms), clearTick = (id) => clearInterval(id), onChange = () => {},
} = {}) {
  const state = { status: 'idle', error: null, elapsedMs: 0, result: null }
  let stream = null; let recorder = null; let chunks = []; let startedAt = 0; let ticker = null; let token = 0; let wantStop = null
  let fmt = null

  const emit = (patch) => { Object.assign(state, patch); onChange({ ...state }) }
  const release = () => { if (ticker !== null) { clearTick(ticker); ticker = null } if (stream) { try { stream.getTracks().forEach((t) => t.stop()) } catch { /* already stopped */ } stream = null } }
  const fail = (code) => { release(); recorder = null; chunks = []; emit({ status: 'error', error: code, elapsedMs: 0, result: null }) }

  function finish(my) {
    if (my !== token) return // cancelled or superseded: discard silently
    const durationMs = Math.min(Math.max(now() - startedAt, 0), VOICE.maxMs)
    const type = baseMime((recorder && recorder.mimeType) || (fmt && fmt.mime) || (chunks[0] && chunks[0].type))
    const blob = new Blob(chunks, { type })
    release(); recorder = null; chunks = []
    if (durationMs < VOICE.minMs) return emit({ status: 'error', error: 'too_short', elapsedMs: 0, result: null })
    if (blob.size > VOICE.maxBytes) return emit({ status: 'error', error: 'too_big', elapsedMs: 0, result: null })
    if (!VOICE_BASES.includes(type)) return emit({ status: 'error', error: 'format', elapsedMs: 0, result: null })
    emit({ status: 'recorded', error: null, elapsedMs: durationMs, result: { blob, durationMs, mime: type } })
  }

  const api = {
    state: () => ({ ...state }),
    async start() {
      if (state.status === 'requesting' || state.status === 'recording') return
      if (!Rec || !nav || !nav.mediaDevices || !nav.mediaDevices.getUserMedia) return fail('unsupported')
      if (secure === false) return fail('insecure')
      fmt = pickVoiceFormat(Rec)
      if (!fmt) return fail('unsupported')
      const my = ++token
      emit({ status: 'requesting', error: null, elapsedMs: 0, result: null })
      let s
      try { s = await nav.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }) } catch (e) { if (my === token) fail(classifyMicError(e)); return }
      if (my !== token) { try { s.getTracks().forEach((t) => t.stop()) } catch { /* ignore */ } return } // cancelled while the permission prompt was open
      stream = s; chunks = []
      try { recorder = new Rec(stream, fmt.mime ? { mimeType: fmt.mime, audioBitsPerSecond: fmt.bitrate } : { audioBitsPerSecond: fmt.bitrate }) } catch { return fail('failed') }
      recorder.ondataavailable = (e) => { if (e && e.data && e.data.size > 0) chunks.push(e.data) }
      recorder.onerror = () => { if (my === token) fail('failed') }
      recorder.onstop = () => { const w = wantStop; wantStop = null; if (w === 'cancel') return; finish(my) }
      try { recorder.start(1000) } catch { return fail('failed') } // a slice every second: little is lost if the page dies
      startedAt = now()
      emit({ status: 'recording', elapsedMs: 0 })
      ticker = setTick(() => {
        const elapsed = now() - startedAt
        emit({ elapsedMs: Math.min(elapsed, VOICE.maxMs) })
        if (elapsed >= VOICE.maxMs) api.stop() // the limit stops the recording and keeps what was said
      }, 200)
    },
    /** Ends recording and moves to the preview (or an error such as too_short). */
    stop() { if (state.status === 'recording' && recorder && recorder.state !== 'inactive') { wantStop = 'stop'; recorder.stop() } },
    /** Throws the recording away and releases the microphone. */
    cancel() {
      token += 1
      if (recorder && recorder.state !== 'inactive') { wantStop = 'cancel'; try { recorder.stop() } catch { /* ignore */ } }
      release(); recorder = null; chunks = []
      emit({ status: 'idle', error: null, elapsedMs: 0, result: null })
    },
    /** Preview -> delete and record again. */
    discard() { api.cancel() },
    dismissError() { if (state.status === 'error') emit({ status: 'idle', error: null }) },
    dispose() { api.cancel() },
  }
  return api
}
