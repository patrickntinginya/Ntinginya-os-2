// Press-and-hold logic for the microphone button, separate from React so it can be tested.
//   press and HOLD, then release  -> 'stop'   (recording ends, preview opens)
//   quick TAP                     -> 'latch'  (recording keeps going; the person taps Stop or Cancel: this also works with a keyboard / screen reader)
//   release after sliding left    -> 'cancel'
export function createHoldGesture({ holdMs = 450, cancelDx = 90, now = () => Date.now() } = {}) {
  let down = null
  return {
    start(x) { down = { t: now(), x } },
    /** Is the finger far enough to the left that releasing now would cancel? */
    wouldCancel(x) { return Boolean(down) && x - down.x <= -cancelDx },
    end(x) {
      if (!down) return null
      const held = now() - down.t; const cancel = x - down.x <= -cancelDx
      down = null
      return cancel ? 'cancel' : held >= holdMs ? 'stop' : 'latch'
    },
    abort() { down = null },
    active: () => Boolean(down),
  }
}
