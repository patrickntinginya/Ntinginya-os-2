// One YouTube playback session inside Safe Mode, driven by the official IFrame Player API (see youtube.js).
// Framework-free so it can be unit-tested with a fake API. It never navigates anywhere: every failure becomes a `status` the screen
// explains in place. It never downloads, scrapes or bypasses anything; embedding restrictions (errors 101/150) are respected.
import { explainYouTubeError, loadYouTubeApi, playerVars, YT_HOST, YT_STATE } from './youtube.js'
import { readResume, writeResume } from './resume.js'

export const SAVE_EVERY_MS = 5000

/**
 * status: 'loading' | 'ready' | 'playing' | 'paused' | 'ended'                       (normal)
 *         'offline' | 'blocked' | 'timeout'                                          (the player script could not load)
 *         'embed_blocked' | 'unavailable' | 'invalid' | 'html5' | 'unknown'          (YouTube reported an error for this video)
 */
export function createYouTubeSession({ videoId, mount, storage = null, origin = '', load = loadYouTubeApi, onChange = () => {}, setTimer = setInterval, clearTimer = clearInterval }) {
  let player = null
  let destroyed = false
  let timer = null
  let startedAt = 0
  const state = { status: 'loading', retry: false }

  const emit = (patch) => { Object.assign(state, patch); if (!destroyed) onChange({ ...state }) }
  const save = () => {
    try {
      const t = player && player.getCurrentTime ? player.getCurrentTime() : NaN
      const d = player && player.getDuration ? player.getDuration() : NaN
      if (Number.isFinite(t)) writeResume(storage, 'youtube', videoId, t, d)
    } catch { /* the player may already be gone */ }
  }
  const stopTimer = () => { if (timer !== null) { clearTimer(timer); timer = null } }

  async function start() {
    destroyed = false
    emit({ status: 'loading', retry: false })
    let YT
    try { YT = await load() } catch (e) {
      const why = String((e && e.message) || '')
      emit({ status: why === 'offline' ? 'offline' : why === 'timeout' ? 'timeout' : 'blocked', retry: true })
      return
    }
    if (destroyed) return
    startedAt = readResume(storage, 'youtube', videoId)
    try {
      player = new YT.Player(mount, {
        host: YT_HOST,
        videoId,
        playerVars: playerVars({ origin, start: startedAt }),
        events: {
          onReady: () => emit({ status: 'ready' }),
          onStateChange: (e) => {
            const s = e && e.data
            if (s === YT_STATE.PLAYING) { emit({ status: 'playing' }); if (timer === null) timer = setTimer(save, SAVE_EVERY_MS) }
            else if (s === YT_STATE.PAUSED) { stopTimer(); save(); emit({ status: 'paused' }) }
            else if (s === YT_STATE.ENDED) { stopTimer(); save(); emit({ status: 'ended' }) }
          },
          onError: (e) => { stopTimer(); const x = explainYouTubeError(e && e.data); emit({ status: x.kind, retry: x.retry }) },
        },
      })
    } catch { emit({ status: 'unknown', retry: true }) }
  }

  function destroy() {
    if (destroyed) return
    stopTimer()
    save()
    destroyed = true
    try { player && player.destroy && player.destroy() } catch { /* ignore */ }
    player = null
  }

  return { start, destroy, state: () => ({ ...state }), resumeFrom: () => startedAt }
}
