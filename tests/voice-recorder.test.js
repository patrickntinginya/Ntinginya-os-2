import assert from 'node:assert/strict'
import test from 'node:test'
import { VOICE, baseMime, formatDuration, pickVoiceFormat, validateVoice, voiceFileName } from '../src/lib/voiceFormat.js'
import { classifyMicError, createVoiceRecorder, VOICE_ERRORS } from '../src/lib/voiceRecorder.js'
import { createHoldGesture } from '../src/lib/holdGesture.js'
import { UploadError, uploadWithProgress } from '../src/lib/uploadProgress.js'

// ---------- fakes ----------
function makeRec({ supported = ['audio/webm;codecs=opus', 'audio/webm'], mimeType, bytes = 2000, onlyOnStopData = false } = {}) {
  const made = []
  class Rec {
    static isTypeSupported(m) { return supported.includes(m) }
    constructor(stream, opts) { this.stream = stream; this.opts = opts; this.state = 'inactive'; this.mimeType = mimeType === undefined ? (opts.mimeType || 'audio/webm') : mimeType; made.push(this) }
    start(slice) { this.state = 'recording'; this.slice = slice }
    stop() { if (this.state === 'inactive') return; this.state = 'inactive'; if (this.ondataavailable) this.ondataavailable({ data: new Blob([new Uint8Array(bytes)]) }); if (this.onstop) this.onstop() }
  }
  Rec.made = made
  return Rec
}
function makeNav({ error = null, delay = null } = {}) {
  const log = { tracks: [], calls: [] }
  const stream = { getTracks: () => [{ stop: () => log.tracks.push('stopped') }] }
  const nav = { mediaDevices: { getUserMedia: async (c) => { log.calls.push(c); if (delay) await delay; if (error) { const e = new Error('x'); e.name = error; throw e } return stream } } }
  return { nav, log }
}
function harness(o = {}) {
  const Rec = o.Rec || makeRec(o.rec); const { nav, log } = o.navObj || makeNav(o.nav)
  const clock = { t: 1000 }; const ticks = []; const changes = []
  const rec = createVoiceRecorder({ nav: o.noNav ? null : nav, Rec: o.noRec ? null : Rec, secure: o.secure, now: () => clock.t, setTick: (f) => { ticks.push(f); return ticks.length }, clearTick: () => {}, onChange: (s) => changes.push(s.status) })
  return { rec, Rec, log, clock, ticks, changes }
}

// ---------- format ----------
test('format: best supported container first, mobile Safari falls back to MP4, bitrates are speech-sized', () => {
  assert.deepEqual(pickVoiceFormat(makeRec()), { mime: 'audio/webm;codecs=opus', base: 'audio/webm', bitrate: 24000 })
  const safari = pickVoiceFormat(makeRec({ supported: ['audio/mp4'] }))
  assert.equal(safari.base, 'audio/mp4'); assert.equal(safari.bitrate, 32000)
  assert.equal(pickVoiceFormat(makeRec({ supported: [] })), null)
  assert.equal(pickVoiceFormat(null), null)
  assert.equal(pickVoiceFormat(class {}).mime, '', 'no isTypeSupported: the browser chooses')
  assert.equal(baseMime('Audio/WebM; codecs=opus'), 'audio/webm')
})
test('format: file names and the human duration', () => {
  assert.equal(voiceFileName('audio/webm;codecs=opus', new Date(2026, 9, 31, 14, 5, 9)), 'voice-20261031-140509.webm')
  assert.equal(voiceFileName('audio/mp4', new Date(2026, 0, 2, 3, 4, 5)), 'voice-20260102-030405.m4a')
  assert.deepEqual([0, 7000, 65000, 750000].map(formatDuration), ['0:00', '0:07', '1:05', '12:30'])
})
test('format: limits (<= 5 min, <= 5 MB, allowed container, not a mis-tap)', () => {
  assert.equal(VOICE.maxMs, 300000); assert.equal(VOICE.maxBytes, 5242880)
  assert.equal(validateVoice({ durationMs: 8000, size: 40000, mime: 'audio/webm' }), null)
  assert.match(validateVoice({ durationMs: 100, size: 40000, mime: 'audio/webm' }), /too short/)
  assert.match(validateVoice({ durationMs: 400000, size: 40000, mime: 'audio/webm' }), /5 minutes/)
  assert.match(validateVoice({ durationMs: 8000, size: 6000000, mime: 'audio/webm' }), /5 MB/)
  assert.match(validateVoice({ durationMs: 8000, size: 0, mime: 'audio/webm' }), /empty/)
  assert.match(validateVoice({ durationMs: 8000, size: 10, mime: 'video/webm' }), /format/)
})
test('format: 24 kbit/s keeps a 5-minute message far below the 5 MB cap (so the cap only trips on a broken recorder)', () => {
  assert.ok((VOICE.bitrate / 8) * 300 < VOICE.maxBytes / 4, `${(VOICE.bitrate / 8) * 300} bytes`)
})

// ---------- recorder ----------
test('recording: asks for the microphone, records with compression settings, previews, and releases the microphone', async () => {
  const h = harness()
  await h.rec.start()
  assert.equal(h.rec.state().status, 'recording')
  assert.deepEqual(h.log.calls[0].audio, { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 })
  const r = h.Rec.made[0]; assert.equal(r.opts.mimeType, 'audio/webm;codecs=opus'); assert.equal(r.opts.audioBitsPerSecond, 24000); assert.equal(r.slice, 1000)
  h.clock.t += 7300; h.rec.stop()
  const s = h.rec.state()
  assert.equal(s.status, 'recorded'); assert.equal(s.result.durationMs, 7300); assert.equal(s.result.mime, 'audio/webm'); assert.ok(s.result.blob.size > 0); assert.equal(s.result.blob.type, 'audio/webm')
  assert.deepEqual(h.log.tracks, ['stopped'], 'the microphone is released as soon as recording ends')
  assert.deepEqual(h.changes, ['requesting', 'recording', 'recorded'])
})
test('recording: delete and re-record starts clean', async () => {
  const h = harness(); await h.rec.start(); h.clock.t += 2000; h.rec.stop()
  h.rec.discard(); assert.deepEqual([h.rec.state().status, h.rec.state().result], ['idle', null])
  await h.rec.start(); h.clock.t += 3000; h.rec.stop(); assert.equal(h.rec.state().result.durationMs, 3000)
})
test('cancel while recording throws everything away and releases the microphone', async () => {
  const h = harness(); await h.rec.start(); h.clock.t += 4000; h.rec.cancel()
  assert.deepEqual([h.rec.state().status, h.rec.state().result], ['idle', null]); assert.deepEqual(h.log.tracks, ['stopped'])
})
test('cancel while the permission prompt is still open: the microphone is released the moment it is granted', async () => {
  let open; const delay = new Promise((r) => { open = r })
  const h = harness({ navObj: makeNav({ delay }) })
  const p = h.rec.start(); assert.equal(h.rec.state().status, 'requesting')
  h.rec.cancel(); open(); await p
  assert.equal(h.rec.state().status, 'idle'); assert.deepEqual(h.log.tracks, ['stopped']); assert.equal(h.Rec.made.length, 0, 'nothing was recorded')
})
test('permission and device problems become specific, translatable errors', async () => {
  for (const [name, code] of [['NotAllowedError', 'permission_denied'], ['SecurityError', 'permission_denied'], ['NotFoundError', 'no_device'], ['NotReadableError', 'busy'], ['WeirdError', 'failed']]) {
    const h = harness({ navObj: makeNav({ error: name }) }); await h.rec.start()
    assert.deepEqual([h.rec.state().status, h.rec.state().error], ['error', code], name); assert.ok(VOICE_ERRORS[code]); assert.equal(classifyMicError({ name }), code)
  }
  const h = harness({ navObj: makeNav({ error: 'NotAllowedError' }) }); await h.rec.start(); h.rec.dismissError(); assert.equal(h.rec.state().status, 'idle')
})
test('unsupported browsers and insecure pages fail clearly before asking for anything', async () => {
  for (const [opts, code] of [[{ noRec: true }, 'unsupported'], [{ noNav: true }, 'unsupported'], [{ secure: false }, 'insecure'], [{ rec: { supported: [] } }, 'unsupported']]) {
    const h = harness(opts); await h.rec.start(); assert.equal(h.rec.state().error, code, JSON.stringify(opts)); assert.equal(h.log.calls.length, 0)
  }
})
test('a tap that records under half a second is rejected, not sent', async () => {
  const h = harness(); await h.rec.start(); h.clock.t += 200; h.rec.stop()
  assert.deepEqual([h.rec.state().status, h.rec.state().error], ['error', 'too_short']); assert.deepEqual(h.log.tracks, ['stopped'])
})
test('the 5-minute limit stops the recording by itself and keeps what was said', async () => {
  const h = harness(); await h.rec.start()
  h.clock.t += 150000; h.ticks[0](); assert.equal(h.rec.state().status, 'recording'); assert.equal(h.rec.state().elapsedMs, 150000)
  h.clock.t += 170000; h.ticks[0]()
  const s = h.rec.state(); assert.equal(s.status, 'recorded'); assert.equal(s.result.durationMs, VOICE.maxMs)
})
test('a recording that is somehow over 5 MB, or in a format the bucket refuses, is rejected', async () => {
  const big = harness({ rec: { bytes: 6000000 } }); await big.rec.start(); big.clock.t += 5000; big.rec.stop(); assert.equal(big.rec.state().error, 'too_big')
  const bad = harness({ rec: { mimeType: 'video/webm' } }); await bad.rec.start(); bad.clock.t += 5000; bad.rec.stop(); assert.equal(bad.rec.state().error, 'format')
})
test('recorder errors and double starts are handled', async () => {
  const h = harness(); await h.rec.start(); await h.rec.start(); assert.equal(h.log.calls.length, 1, 'a second start while recording does nothing')
  h.Rec.made[0].onerror(); assert.deepEqual([h.rec.state().status, h.rec.state().error], ['error', 'failed']); assert.deepEqual(h.log.tracks, ['stopped'])
  const d = harness(); await d.rec.start(); d.rec.dispose(); assert.equal(d.rec.state().status, 'idle'); assert.deepEqual(d.log.tracks, ['stopped'])
})
test('methods work when passed around as callbacks (no hidden `this`)', async () => {
  const h = harness(); const { start, stop, cancel } = h.rec
  await start(); h.clock.t += 1500; stop(); assert.equal(h.rec.state().status, 'recorded'); cancel(); assert.equal(h.rec.state().status, 'idle')
})

// ---------- hold gesture ----------
test('hold gesture: hold then release stops; a quick tap latches; sliding left cancels', () => {
  let t = 0; const g = createHoldGesture({ now: () => t })
  g.start(200); t = 1500; assert.equal(g.end(200), 'stop')
  g.start(200); t = 1600; assert.equal(g.end(205), 'latch')
  g.start(200); assert.equal(g.wouldCancel(100), true); assert.equal(g.wouldCancel(150), false); t = 3000; assert.equal(g.end(90), 'cancel')
  assert.equal(g.end(0), null, 'no press in progress'); g.start(1); g.abort(); assert.equal(g.active(), false)
})

// ---------- upload with progress ----------
function fakeXHR({ status = 200, fail = null, steps = [[25, 100], [100, 100]] } = {}) {
  return class X {
    constructor() { this.headers = {}; this.upload = {}; X.last = this }
    open(m, u, a) { this.method = m; this.url = u; this.async = a }
    setRequestHeader(k, v) { this.headers[k] = v }
    abort() { this.aborted = true; if (this.onabort) this.onabort() }
    send(body) { this.body = body; queueMicrotask(() => { if (fail === 'network') return this.onerror(); if (fail === 'timeout') return this.ontimeout(); for (const [l, t] of steps) this.upload.onprogress({ lengthComputable: true, loaded: l, total: t }); this.status = status; this.responseText = status >= 400 ? 'denied' : ''; this.onload() }) }
  }
}
test('upload: reports real progress, sends the raw body with the token and content type', async () => {
  const X = fakeXHR(); const seen = []
  const r = await uploadWithProgress({ url: 'https://p.supabase.co/storage/v1/object/chat-media/a/b/c.webm', headers: { Authorization: 'Bearer T', 'x-upsert': 'false' }, body: 'BODY', contentType: 'audio/webm', onProgress: (p) => seen.push(p.percent), XHR: X })
  assert.equal(r.status, 200); assert.deepEqual(seen, [25, 100, 100])
  assert.deepEqual([X.last.method, X.last.body, X.last.headers.Authorization, X.last.headers['Content-Type'], X.last.headers['x-upsert']], ['POST', 'BODY', 'Bearer T', 'audio/webm', 'false'])
})
test('upload: server refusals carry the status; network/timeout/abort are distinct', async () => {
  await assert.rejects(uploadWithProgress({ url: 'u', body: 'x', XHR: fakeXHR({ status: 403 }) }), (e) => e instanceof UploadError && e.status === 403 && /denied/.test(e.message))
  await assert.rejects(uploadWithProgress({ url: 'u', body: 'x', XHR: fakeXHR({ fail: 'network' }) }), (e) => e.message === 'network')
  await assert.rejects(uploadWithProgress({ url: 'u', body: 'x', XHR: fakeXHR({ fail: 'timeout' }) }), (e) => e.message === 'timeout')
  const ac = new AbortController(); ac.abort()
  await assert.rejects(uploadWithProgress({ url: 'u', body: 'x', signal: ac.signal, XHR: fakeXHR() }), (e) => e.name === 'AbortError')
  await assert.rejects(uploadWithProgress({ url: 'u', body: 'x', XHR: null }), (e) => e.message === 'no_xhr')
})
