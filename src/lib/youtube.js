// Official YouTube embedding (IFrame Player API). Nothing here downloads, scrapes or bypasses anything:
// the video plays inside YouTube's own player, with its own controls and ads, and the owner's embedding settings are respected.
export const YT_API_SRC = 'https://www.youtube.com/iframe_api'
export const YT_HOST = 'https://www.youtube-nocookie.com' // privacy-enhanced mode: no tracking cookies until the user plays
export const YT_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }

/**
 * What the player's onError codes mean (https://developers.google.com/youtube/iframe_api_reference#onError).
 * 2 invalid id · 5 HTML5 player problem · 100 removed or private · 101/150 the owner does not allow embedding.
 */
export function explainYouTubeError(code) {
  const c = Number(code)
  if (c === 101 || c === 150) return { kind: 'embed_blocked', retry: false }
  if (c === 100) return { kind: 'unavailable', retry: false }
  if (c === 2) return { kind: 'invalid', retry: false }
  if (c === 5) return { kind: 'html5', retry: true }
  return { kind: 'unknown', retry: true }
}

/** Player options. No autoplay parameter; inline playback on phones; related videos limited to the same channel. */
export function playerVars({ origin, start = 0 } = {}) {
  const vars = { playsinline: 1, rel: 0, controls: 1, fs: 1, enablejsapi: 1, iv_load_policy: 3 }
  if (origin && /^https?:\/\//.test(origin)) vars.origin = origin
  if (Number.isFinite(start) && start > 0) vars.start = Math.floor(start)
  return vars
}

let apiPromise = null
/** Loads the official API script once. Rejects with Error('offline' | 'blocked' | 'timeout') so the screen can say which. */
export function loadYouTubeApi({ doc = typeof document !== 'undefined' ? document : null, win = typeof window !== 'undefined' ? window : null, timeoutMs = 12000 } = {}) {
  if (!doc || !win) return Promise.reject(new Error('blocked'))
  if (win.YT && win.YT.Player) return Promise.resolve(win.YT)
  if (win.navigator && win.navigator.onLine === false) return Promise.reject(new Error('offline'))
  if (apiPromise) return apiPromise
  apiPromise = new Promise((resolve, reject) => {
    const previous = win.onYouTubeIframeAPIReady
    const fail = (why) => { clearTimeout(timer); apiPromise = null; reject(new Error(why)) }
    const timer = setTimeout(() => fail('timeout'), timeoutMs)
    win.onYouTubeIframeAPIReady = () => { clearTimeout(timer); if (typeof previous === 'function') previous(); resolve(win.YT) }
    const script = doc.createElement('script')
    script.src = YT_API_SRC
    script.async = true
    script.onerror = () => { script.remove(); fail('blocked') } // content blocker, DNS, captive portal...
    doc.head.appendChild(script)
  })
  return apiPromise
}
