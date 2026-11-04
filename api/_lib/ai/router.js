// Multi-provider router: bounded retry -> automatic failover -> health tracking -> safe diagnostics.
// Reuses callModel() from ./provider.js (which keeps Gemini's own model fallback); it does not replace it.
//
// Why this is safe to retry: a model call has no side effects of its own. The handler writes messages and action
// requests only AFTER routeModel() returns one complete, validated answer, and proposed actions are stored as pending,
// never executed. Each attempt is a separate complete request; text from two providers is never combined. The current
// transport is non-streaming, so no partial output can reach the browser. If streaming is added later, failover must be
// disabled once the first byte has been sent (see AI_SETUP.md).
import { callModel, resolveNamed, resolveProvider, ProviderError } from './provider.js'
import { sharedHealth } from './health.js'

const clampInt = (v, fallback, min, max) => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= min ? Math.min(n, max) : fallback
}

/** Hosting limit is 30s (vercel.json + api/ai-chat.js). The default budget leaves headroom for auth + database work. */
export function routerLimits(env = {}) {
  return {
    totalMs: clampInt(env.AI_TOTAL_DEADLINE_MS, 22_000, 3_000, 27_000),
    attemptMs: clampInt(env.AI_ATTEMPT_TIMEOUT_MS, 10_000, 2_000, 25_000),
    maxRetries: clampInt(env.AI_MAX_RETRIES, 1, 0, 3),
    minAttemptMs: 2_500,       // never start an attempt that cannot realistically finish
    backoffBaseMs: 400,
    backoffMaxMs: 3_000,
    maxRetryAfterMs: 5_000,    // a longer Retry-After is not waited for: failover (or an error) is faster for the user
  }
}

export const SELECTIONS = ['auto', 'gemini', 'openrouter']
export const normalizeSelection = (v) => (SELECTIONS.includes(v) ? v : 'auto')

const RETRYABLE = new Set(['timeout', 'network', 'rate_limit', 'server', 'malformed'])
// Failures that make another provider worth trying in automatic mode. Config problems are included on purpose:
// a bad Gemini key must not take the whole assistant down while OpenRouter works.
const FAILOVER = new Set(['timeout', 'network', 'rate_limit', 'server', 'malformed', 'auth', 'model', 'not_ready', 'bad_request'])

const defaultSleep = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms)
  signal?.addEventListener?.('abort', () => { clearTimeout(t); resolve() }, { once: true })
})

/** Which providers does the server have configured? Never includes keys. */
export function configuredProviders(env) {
  const primary = resolveProvider(env)
  const list = []
  const seen = new Set()
  const add = (cfg) => { if (cfg.configured && !seen.has(cfg.name)) { seen.add(cfg.name); list.push(cfg) } }
  add(primary)
  add(resolveNamed('gemini', env))
  add(resolveNamed('openrouter', env))
  return { primary, list }
}

/** Ordered candidates for a selection. Explicit selection means exactly that provider and no silent switching. */
export function pickCandidates(env, selection) {
  const { primary, list } = configuredProviders(env)
  const sel = normalizeSelection(selection)
  if (sel === 'auto') {
    if (primary.name === 'none') return []
    return ['gemini', 'openrouter']
      .map((name) => list.find((cfg) => cfg.name === name))
      .filter(Boolean)
  }
  return list.filter((c) => c.name === sel)
}

/** Browser-safe summary for the provider picker: only providers that are configured, plus coarse health. */
export function availability(env, health = sharedHealth) {
  const { list } = configuredProviders(env)
  return list.filter((c) => ['gemini', 'openrouter'].includes(c.name)).map((c) => ({ name: c.name, health: health.statusOf(c.name) === 'healthy' ? 'ok' : 'degraded' }))
}

let counter = 0
export const newCorrelationId = () => `ai_${Date.now().toString(36)}_${(counter++ % 1296).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/**
 * Runs one model request through the providers allowed by `selection`.
 * Resolves to { result, provider, model, fallbackUsed, attempts, correlationId } or throws a ProviderError whose
 * `kind` is the most useful one to show, with `.attempts`, `.tried` and `.correlationId` attached (all safe to log).
 */
export async function routeModel(env, request, opts = {}) {
  const {
    selection = 'auto', health = sharedHealth, now = () => Date.now(), sleep = defaultSleep, call = callModel,
    signal, partialSent = () => false, correlationId = newCorrelationId(), logger = (e) => console.log(JSON.stringify(e)), random = Math.random,
  } = opts
  const limits = { ...routerLimits(env), ...(opts.limits || {}) }
  if (opts.noRetries) limits.maxRetries = 0
  const startedAt = now()
  const deadline = startedAt + limits.totalMs
  const remaining = () => deadline - now()
  const candidates = pickCandidates(env, selection)
  const explicit = normalizeSelection(selection) !== 'auto'
  const log = (e) => { const ev = { evt: 'ai_route', cid: correlationId, ...e }; health.pushEvent({ at: new Date(now()).toISOString(), ...e, cid: correlationId }); try { logger(ev) } catch { /* logging must never break a request */ } }

  if (!candidates.length) {
    const err = new ProviderError('not_ready', 'not_ready')
    err.attempts = 0; err.tried = []; err.correlationId = correlationId
    log({ provider: explicit ? selection : 'none', selectedProvider: null, outcome: 'error', failureKind: 'not_ready', fallbackAttempted: false, fallbackSucceeded: false, durationMs: 0, requestDurationMs: now() - startedAt })
    throw err
  }

  let attempts = 0
  const tried = []
  let lastErr = null
  let sawSkipped = false

  for (let i = 0; i < candidates.length; i++) {
    const cfg = candidates[i]
    const hasNext = i < candidates.length - 1
    const gate = health.acquire(cfg.name)
    if (!gate.allowed) {
      // In a cooldown. Automatic mode skips it; explicit mode still honours the user's choice with one try only if no
      // other provider exists, otherwise the user would be locked out of their own choice.
      if (!explicit) { sawSkipped = true; log({ provider: cfg.name, outcome: 'skipped', failureKind: health.statusOf(cfg.name), fallback: i > 0, durationMs: 0 }); continue }
    }
    let retriesLeft = limits.maxRetries
    for (let n = 0; ; n++) {
      if (signal?.aborted) { const e = new ProviderError('cancelled', 'cancelled'); e.attempts = attempts; e.tried = tried; e.correlationId = correlationId; throw e }
      const left = remaining()
      if (left < limits.minAttemptMs) { lastErr = lastErr || new ProviderError('timeout', 'timeout'); break }
      const attemptMs = Math.min(limits.attemptMs, left - 500)
      const t0 = now()
      attempts++
      try {
        const result = await call(cfg, { ...request, timeoutMs: attemptMs, signal })
        const d = now() - t0
        health.recordSuccess(cfg.name, d)
        if (!tried.includes(cfg.name)) tried.push(cfg.name) // a retry on the same provider is not a provider switch
        const fallbackSucceeded = i > 0 || sawSkipped
        log({ provider: cfg.name, selectedProvider: candidates[0].name, model: cfg.model, outcome: 'success', fallbackAttempted: fallbackSucceeded, fallbackSucceeded, attempt: attempts, durationMs: d, requestDurationMs: now() - startedAt })
        return { result, provider: cfg.name, model: cfg.model, fallbackUsed: tried.length > 1 || i > 0, attempts, correlationId }
      } catch (e) {
        const err = e instanceof ProviderError ? e : new ProviderError('server', 'server')
        const d = now() - t0
        lastErr = err
        if (!tried.includes(cfg.name)) tried.push(cfg.name)
        health.recordFailure(cfg.name, err.kind, { retryAfterMs: err.retryAfterMs })
        log({ provider: cfg.name, failedProvider: cfg.name, selectedProvider: candidates[0].name, model: cfg.model, outcome: 'failure', failureKind: err.kind, httpStatus: err.httpStatus, fallbackAttempted: i > 0, fallbackSucceeded: false, attempt: attempts, durationMs: d, requestDurationMs: now() - startedAt })
        if (err.kind === 'cancelled') { err.attempts = attempts; err.tried = tried; err.correlationId = correlationId; throw err }
        // Streaming guard: once any text has reached the user, a retry or a switch would restart (duplicate) or splice
        // (mix providers) the answer. The error is surfaced instead and the client keeps the question for a manual retry.
        // The current transport is not streaming, so partialSent() is always false today.
        if (partialSent()) { err.partial = true; err.attempts = attempts; err.tried = tried; err.correlationId = correlationId; throw err }

        // Retry the same provider only for transient failures, inside the retry budget and the deadline.
        // A timeout is not retried when another provider is waiting: that time is better spent on the fallback.
        const willFailOver = !explicit && hasNext && FAILOVER.has(err.kind)
        let wait = Math.min(limits.backoffBaseMs * 2 ** n, limits.backoffMaxMs)
        wait += Math.floor(random() * 150)
        if (err.kind === 'rate_limit') {
          if (!err.retryAfterMs) { if (willFailOver || retriesLeft <= 0) break; wait = Math.max(wait, 1000) } // unknown reset: no quick hammering
          else if (err.retryAfterMs > limits.maxRetryAfterMs) break // would wait too long: fail over / report
          else wait = Math.max(wait, err.retryAfterMs)
        }
        const retryable = RETRYABLE.has(err.kind) && retriesLeft > 0 && !(err.kind === 'timeout' && willFailOver)
        if (!retryable) break
        if (remaining() - wait < limits.minAttemptMs) break // not enough time left for a useful second attempt
        retriesLeft--
        await sleep(wait, signal)
      }
    }
    // Explicit selection never silently switches providers.
    if (explicit) break
  }

  const err = lastErr || new ProviderError('server', 'server')
  const final = new ProviderError(err.message, sawSkipped && attempts === 0 ? 'server' : err.kind)
  final.httpStatus = err.httpStatus
  final.retryAfterMs = err.retryAfterMs
  final.attempts = attempts; final.tried = tried; final.correlationId = correlationId
  final.bothFailed = !explicit && candidates.length > 1
  log({ provider: tried.join('>') || 'none', failedProvider: tried.at(-1) || null, selectedProvider: candidates[0].name, outcome: 'error', failureKind: final.kind, httpStatus: final.httpStatus, fallbackAttempted: tried.length > 1, fallbackSucceeded: false, attempts, durationMs: now() - startedAt, requestDurationMs: now() - startedAt })
  throw final
}
