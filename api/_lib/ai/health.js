// Provider health monitor. Tracks status, consecutive failures, last success, recent latency, rate-limit state and a
// bounded cooldown per provider. State lives in the memory of one serverless instance: instances do not share it, so
// it is a best-effort optimisation (skip a provider that just failed), never a source of truth. A cold instance starts
// healthy, which is the safe default.
//
// Recovery is "half-open": when a cooldown expires, exactly ONE request is allowed through as a probe. Success closes
// the circuit; failure starts a longer (still bounded) cooldown. Nothing is ever disabled permanently.
const LATENCY_WINDOW = 10
const EVENT_WINDOW = 50

export const DEFAULTS = Object.freeze({
  failureThreshold: 3,      // consecutive transient failures before a cooldown starts
  baseCooldownMs: 30_000,
  maxCooldownMs: 300_000,   // 5 minutes: hard ceiling
  configCooldownMs: 300_000, // auth/permission/model errors: skip for a while, then probe again (keys can be fixed)
  probeLeaseMs: 20_000,     // a probe that never reports back frees the slot after this long
})

export function createHealthMonitor({ now = () => Date.now(), options = {} } = {}) {
  const opt = { ...DEFAULTS, ...options }
  const providers = new Map()
  const events = []

  const get = (name) => {
    if (!providers.has(name)) providers.set(name, { consecutiveFailures: 0, lastSuccessAt: null, lastFailureAt: null, lastFailureKind: null, latencies: [], cooldownUntil: 0, rateLimitedUntil: 0, probeUntil: 0, totals: { ok: 0, fail: 0 } })
    return providers.get(name)
  }

  /** Decide whether a provider may be tried now. Returns { allowed, probe }. */
  function acquire(name) {
    const s = get(name), t = now()
    const until = Math.max(s.cooldownUntil, s.rateLimitedUntil)
    if (t < until) return { allowed: false, probe: false }
    if (until > 0) { // cooldown expired -> half-open: a single probe at a time
      if (t < s.probeUntil) return { allowed: false, probe: false }
      s.probeUntil = t + opt.probeLeaseMs
      return { allowed: true, probe: true }
    }
    return { allowed: true, probe: false }
  }

  function recordSuccess(name, durationMs) {
    const s = get(name)
    s.consecutiveFailures = 0
    s.cooldownUntil = 0
    s.rateLimitedUntil = 0
    s.probeUntil = 0
    s.lastSuccessAt = now()
    s.latencies.push(durationMs)
    if (s.latencies.length > LATENCY_WINDOW) s.latencies.shift()
    s.totals.ok++
  }

  /** kind: ProviderError.kind. retryAfterMs: from a Retry-After header when the provider sent one. */
  function recordFailure(name, kind, { retryAfterMs } = {}) {
    if (kind === 'cancelled') { get(name).probeUntil = 0; return } // the user stopping a request says nothing about health
    const s = get(name), t = now()
    s.probeUntil = 0
    s.lastFailureAt = t
    s.lastFailureKind = kind
    s.totals.fail++
    if (kind === 'auth' || kind === 'model' || kind === 'bad_request' || kind === 'not_ready') {
      s.consecutiveFailures++
      s.cooldownUntil = t + opt.configCooldownMs
      return
    }
    s.consecutiveFailures++
    if (kind === 'rate_limit') {
      const wait = Math.min(Math.max(retryAfterMs || opt.baseCooldownMs, 1000), opt.maxCooldownMs)
      s.rateLimitedUntil = t + wait
      return
    }
    if (s.consecutiveFailures >= opt.failureThreshold) {
      const exp = s.consecutiveFailures - opt.failureThreshold
      s.cooldownUntil = t + Math.min(opt.baseCooldownMs * 2 ** exp, opt.maxCooldownMs)
    }
  }

  function statusOf(name) {
    const s = get(name), t = now()
    if (t < s.rateLimitedUntil) return 'rate_limited'
    if (t < s.cooldownUntil) return 'cooldown'
    if (s.consecutiveFailures > 0) return 'degraded'
    return 'healthy'
  }

  function pushEvent(e) {
    events.push(e)
    if (events.length > EVENT_WINDOW) events.shift()
  }

  /** Safe for admins: counters and timings only. No keys, no prompts, no provider response text. */
  function snapshot(names = [...providers.keys()]) {
    const t = now()
    return {
      scope: 'this-server-instance',
      providers: names.map((name) => {
        const s = get(name)
        const lat = s.latencies
        return {
          name,
          status: statusOf(name),
          consecutiveFailures: s.consecutiveFailures,
          lastSuccessAt: s.lastSuccessAt ? new Date(s.lastSuccessAt).toISOString() : null,
          lastFailureKind: s.lastFailureKind,
          avgLatencyMs: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
          cooldownRemainingMs: Math.max(0, Math.max(s.cooldownUntil, s.rateLimitedUntil) - t),
          ok: s.totals.ok,
          failed: s.totals.fail,
        }
      }),
      recent: events.slice(-EVENT_WINDOW),
    }
  }

  return { acquire, recordSuccess, recordFailure, statusOf, pushEvent, snapshot }
}

// One monitor per server instance, shared by every request that instance handles.
export const sharedHealth = createHealthMonitor()
