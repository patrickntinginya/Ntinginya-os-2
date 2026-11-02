// "Continue where you left off" for audio and video. Pure functions over a Storage-like object (localStorage), unit-tested.
export const MIN_SAVE_SECONDS = 5 // below this the item simply starts again
export const END_MARGIN_SECONDS = 10 // within this of the end counts as finished
const key = (scope, id) => `life-os-resume:${scope}:${id}`

export function readResume(storage, scope, id) {
  try {
    const v = Number(storage?.getItem(key(scope, id)))
    return Number.isFinite(v) && v >= MIN_SAVE_SECONDS ? Math.floor(v) : 0
  } catch { return 0 }
}

/** Remembers the position. Starting over (under 5 s) or finishing clears it. Returns true if a position was stored. */
export function writeResume(storage, scope, id, seconds, duration) {
  try {
    const s = Number(seconds)
    const d = Number(duration)
    const finished = Number.isFinite(d) && d > 0 && s >= d - END_MARGIN_SECONDS
    if (!Number.isFinite(s) || s < MIN_SAVE_SECONDS || finished) { storage?.removeItem(key(scope, id)); return false }
    storage?.setItem(key(scope, id), String(Math.floor(s)))
    return true
  } catch { return false }
}
