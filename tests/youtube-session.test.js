// Slice 2 / Safe Mode: YouTube plays inside the app. The session is driven with a fake of the official IFrame API.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createYouTubeSession, SAVE_EVERY_MS } from '../src/lib/youtubeSession.js'
import { YT_HOST, YT_STATE } from '../src/lib/youtube.js'
import { readResume } from '../src/lib/resume.js'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const VID = 'dQw4w9WgXcQ'
const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m } }

function harness({ loadError = null, time = 0, duration = 600, storage = memory() } = {}) {
  const h = { created: [], destroyed: 0, changes: [], timers: [], cleared: [], time, storage }
  class Player {
    constructor(el, opts) { this.opts = opts; h.created.push({ el, opts }); h.player = this }
    getCurrentTime() { return h.time }
    getDuration() { return duration }
    destroy() { h.destroyed += 1 }
  }
  const load = async () => { if (loadError) throw new Error(loadError); return { Player } }
  h.session = createYouTubeSession({
    videoId: VID, mount: { id: 'mount' }, storage, origin: 'https://app.example', load, onChange: (s) => h.changes.push(s.status),
    setTimer: (fn, ms) => { h.timers.push({ fn, ms }); return h.timers.length }, clearTimer: (id) => h.cleared.push(id),
  })
  h.fire = (name, data) => h.player.opts.events[name]({ data })
  return h
}

test('creates the official player in privacy mode, inside the given element, with no autoplay', async () => {
  const h = harness()
  await h.session.start()
  const { el, opts } = h.created[0]
  assert.deepEqual(el, { id: 'mount' })
  assert.equal(opts.host, YT_HOST); assert.equal(opts.host, 'https://www.youtube-nocookie.com')
  assert.equal(opts.videoId, VID)
  assert.equal(opts.playerVars.autoplay, undefined, 'never autoplays')
  assert.equal(opts.playerVars.playsinline, 1, 'plays inline on phones')
  assert.equal(opts.playerVars.origin, 'https://app.example')
  h.fire('onReady')
  assert.deepEqual(h.changes, ['loading', 'ready'])
})

test('continues where the person left off, and clears the position when the video ends', async () => {
  const storage = memory()
  const a = harness({ time: 95, storage })
  await a.session.start(); a.fire('onStateChange', YT_STATE.PLAYING); a.fire('onStateChange', YT_STATE.PAUSED)
  assert.equal(readResume(storage, 'youtube', VID), 95)
  const b = harness({ storage })
  await b.session.start()
  assert.equal(b.created[0].opts.playerVars.start, 95, 'the next session starts at the saved position')
  b.time = 595; b.fire('onStateChange', YT_STATE.ENDED)
  assert.equal(readResume(storage, 'youtube', VID), 0, 'finished videos start again')
})

test('while playing the position is saved on a timer, and exactly one timer exists', async () => {
  const h = harness({ time: 30 })
  await h.session.start()
  h.fire('onStateChange', YT_STATE.PLAYING); h.fire('onStateChange', YT_STATE.PLAYING)
  assert.equal(h.timers.length, 1); assert.equal(h.timers[0].ms, SAVE_EVERY_MS)
  h.time = 42; h.timers[0].fn()
  assert.equal(readResume(h.storage, 'youtube', VID), 42)
  h.fire('onStateChange', YT_STATE.PAUSED)
  assert.equal(h.cleared.length, 1, 'the timer stops on pause')
  assert.equal(h.session.state().status, 'paused')
})

test('a video that may not be embedded is explained in place (no retry, nothing opened)', async () => {
  for (const code of [101, 150]) {
    const h = harness(); await h.session.start(); h.fire('onError', code)
    assert.equal(h.session.state().status, 'embed_blocked'); assert.equal(h.session.state().retry, false)
  }
  const gone = harness(); await gone.session.start(); gone.fire('onError', 100)
  assert.equal(gone.session.state().status, 'unavailable')
  const bad = harness(); await bad.session.start(); bad.fire('onError', 2)
  assert.equal(bad.session.state().status, 'invalid')
  const flaky = harness(); await flaky.session.start(); flaky.fire('onError', 5)
  assert.equal(flaky.session.state().retry, true)
})

test('offline, blocked and slow script loads become clear states and allow a retry', async () => {
  for (const [why, status] of [['offline', 'offline'], ['blocked', 'blocked'], ['timeout', 'timeout'], ['weird', 'blocked']]) {
    const h = harness({ loadError: why }); await h.session.start()
    assert.equal(h.session.state().status, status); assert.equal(h.session.state().retry, true); assert.equal(h.created.length, 0)
  }
})

test('destroy() stops the timer, saves the position, destroys the player and silences late events', async () => {
  const h = harness({ time: 77 })
  await h.session.start(); h.fire('onStateChange', YT_STATE.PLAYING)
  const seen = h.changes.length
  h.session.destroy(); h.session.destroy()
  assert.equal(h.destroyed, 1, 'destroyed once')
  assert.equal(h.cleared.length, 1)
  assert.equal(readResume(h.storage, 'youtube', VID), 77)
  h.fire('onError', 101)
  assert.equal(h.changes.length, seen, 'no updates after destroy')
})

test('destroying before the script finishes loading never creates a player', async () => {
  const h = harness()
  const p = h.session.start(); h.session.destroy(); await p
  assert.equal(h.created.length, 0)
})

test('Safe Mode media UI never navigates away: no outbound links, no window.open, no location changes', () => {
  for (const f of ['src/components/media/YouTubePlayer.jsx', 'src/components/media/DirectVideo.jsx', 'src/components/motivation/MediaTab.jsx', 'src/lib/youtubeSession.js']) {
    const src = read(f)
    assert.ok(!/target=["']_blank/.test(src), `${f}: no target=_blank`)
    assert.ok(!/<a\s/.test(src), `${f}: no anchors`)
    assert.ok(!/window\.open|location\.(href|assign|replace)\s*=|location\.(assign|replace)\(/.test(src), `${f}: no programmatic navigation`)
  }
  assert.ok(!/youTubeWatchUrl/.test(read('src/components/motivation/MediaTab.jsx')))
})

test('every new media string exists in English and Kiswahili', () => {
  const keys = [...read('src/components/media/YouTubePlayer.jsx').matchAll(/'(media\.[\w.]+)'/g), ...read('src/components/media/DirectVideo.jsx').matchAll(/'(media\.[\w.]+)'/g), ...read('src/components/motivation/MediaTab.jsx').matchAll(/'(media\.[\w.]+)'/g)].map((m) => m[1])
  const en = read('src/i18n/en.js'); const sw = read('src/i18n/sw.js')
  for (const k of new Set(keys)) { assert.ok(en.includes(`'${k}'`), `en ${k}`); assert.ok(sw.includes(`'${k}'`), `sw ${k}`) }
})
