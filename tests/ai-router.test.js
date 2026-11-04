import assert from 'node:assert/strict'
import test from 'node:test'
import { routeModel, pickCandidates, availability, routerLimits } from '../api/_lib/ai/router.js'
import { createHealthMonitor } from '../api/_lib/ai/health.js'
import { ProviderError, resolveProvider, resolveNamed, publicStatus } from '../api/_lib/ai/provider.js'
import { openrouter } from '../api/_lib/ai/providers/openrouter.js'
import { handleAiRequest } from '../api/_lib/ai/handler.js'

const G = 'AIza-gemini-secret-1', O = 'sk-or-secret-2'
const BOTH = { GEMINI_API_KEY: G, OPENROUTER_API_KEY: O, OPENROUTER_MODEL: 'vendor/some-model:free' }
const REQ = { system: 'SYS (reply in Kiswahili)', messages: [{ role: 'user', content: 'habari' }], tools: [] }
const ok = (text, extra = {}) => ({ text, toolCalls: [], stopReason: 'stop', ...extra })
const quiet = { logger: () => {}, sleep: async () => {}, random: () => 0 }

// A scripted provider: script[name] is a list of outcomes (value or ProviderError) consumed in order.
function fake(script, clock) {
  const calls = []
  const call = async (cfg, req) => {
    calls.push({ name: cfg.name, req })
    clock && (clock.t += 100)
    const step = (script[cfg.name] || []).shift()
    if (step instanceof Error) throw step
    return step ?? ok(`${cfg.name} answer`)
  }
  return { call, calls }
}
const names = (f) => f.calls.map((c) => c.name)
const clock = () => { const c = { t: 1_000_000 }; c.now = () => c.t; return c }

test('Gemini success does not touch OpenRouter', async () => {
  const f = fake({})
  const r = await routeModel(BOTH, REQ, { ...quiet, call: f.call, health: createHealthMonitor() })
  assert.equal(r.provider, 'gemini'); assert.equal(r.fallbackUsed, false); assert.deepEqual(names(f), ['gemini'])
})
test('automatic mode orders the configured pair as Gemini then OpenRouter', () => {
  assert.deepEqual(pickCandidates(BOTH, 'auto').map((cfg) => cfg.name), ['gemini', 'openrouter'])
})
test('transient 5xx: one bounded retry on the same provider, then success without fallback', async () => {
  const f = fake({ gemini: [new ProviderError('provider_status_503')] })
  const r = await routeModel(BOTH, REQ, { ...quiet, call: f.call, health: createHealthMonitor() })
  assert.deepEqual(names(f), ['gemini', 'gemini']); assert.equal(r.provider, 'gemini'); assert.equal(r.attempts, 2)
})
test('connection-check noRetries option prevents retry but still permits fallback', async () => {
  const f = fake({ gemini: [new ProviderError('provider_status_503')] })
  const r = await routeModel(BOTH, REQ, { ...quiet, noRetries: true, call: f.call, health: createHealthMonitor() })
  assert.equal(r.provider, 'openrouter')
  assert.deepEqual(names(f), ['gemini', 'openrouter'])
})
test('persistent 5xx: retry budget is exhausted, then OpenRouter answers', async () => {
  const f = fake({ gemini: [new ProviderError('provider_status_500'), new ProviderError('provider_status_500'), new ProviderError('provider_status_500')] })
  const r = await routeModel(BOTH, REQ, { ...quiet, call: f.call, health: createHealthMonitor() })
  assert.deepEqual(names(f), ['gemini', 'gemini', 'openrouter']) // 1 try + 1 retry (AI_MAX_RETRIES=1), never more
  assert.equal(r.provider, 'openrouter'); assert.equal(r.fallbackUsed, true)
})
test('timeout goes straight to OpenRouter (time is spent on the fallback, not a repeat)', async () => {
  const f = fake({ gemini: [new ProviderError('timeout')] })
  const r = await routeModel(BOTH, REQ, { ...quiet, call: f.call, health: createHealthMonitor() })
  assert.deepEqual(names(f), ['gemini', 'openrouter']); assert.equal(r.result.text, 'openrouter answer')
})
test('429 without Retry-After fails over immediately; no hammering', async () => {
  const f = fake({ gemini: [new ProviderError('provider_status_429')] })
  const r = await routeModel(BOTH, REQ, { ...quiet, call: f.call, health: createHealthMonitor() })
  assert.deepEqual(names(f), ['gemini', 'openrouter']); assert.equal(r.fallbackUsed, true)
})
test('429 with a short Retry-After waits and retries the same provider', async () => {
  const e = new ProviderError('provider_status_429'); e.retryAfterMs = 1000
  const sleeps = []
  const f = fake({ gemini: [e] })
  const r = await routeModel(BOTH, REQ, { ...quiet, sleep: async (ms) => sleeps.push(ms), call: f.call, health: createHealthMonitor() })
  assert.deepEqual(names(f), ['gemini', 'gemini']); assert.ok(sleeps[0] >= 1000); assert.equal(r.provider, 'gemini')
})
test('429 with a very long Retry-After does not wait: fails over', async () => {
  const e = new ProviderError('provider_status_429'); e.retryAfterMs = 60000
  const f = fake({ gemini: [e] })
  const r = await routeModel(BOTH, REQ, { ...quiet, call: f.call, health: createHealthMonitor() })
  assert.deepEqual(names(f), ['gemini', 'openrouter']); assert.equal(r.provider, 'openrouter')
})
test('invalid Gemini key: no retries, falls back once; and is skipped on the next request until cooldown ends', async () => {
  const c = clock(); const health = createHealthMonitor({ now: c.now })
  const f = fake({ gemini: [new ProviderError('provider_status_401')] }, c)
  const r = await routeModel(BOTH, REQ, { ...quiet, now: c.now, call: f.call, health })
  assert.deepEqual(names(f), ['gemini', 'openrouter']); assert.equal(r.provider, 'openrouter')
  const f2 = fake({}, c)
  await routeModel(BOTH, REQ, { ...quiet, now: c.now, call: f2.call, health })
  assert.deepEqual(names(f2), ['openrouter']) // bad key is not hit again and again
})
test('invalid key with no secondary: one attempt, a config error, never a loop', async () => {
  const f = fake({ gemini: [new ProviderError('provider_status_403'), new ProviderError('provider_status_403')] })
  await assert.rejects(() => routeModel({ GEMINI_API_KEY: G }, REQ, { ...quiet, call: f.call, health: createHealthMonitor() }), (e) => e.kind === 'auth' && e.attempts === 1)
  assert.equal(f.calls.length, 1)
})
test('Gemini not configured but OpenRouter is: OpenRouter answers (config error allows fallback)', async () => {
  const env = { OPENROUTER_API_KEY: O, OPENROUTER_MODEL: 'a/b:free' }
  const f = fake({})
  const r = await routeModel(env, REQ, { ...quiet, call: f.call, health: createHealthMonitor() })
  assert.deepEqual(pickCandidates(env, 'auto').map((cfg) => cfg.name), ['openrouter'])
  assert.equal(r.provider, 'openrouter')
})
test('legacy AI_API_KEY alone never selects Anthropic in automatic mode', async () => {
  const env = { AI_API_KEY: 'legacy-key' }
  const f = fake({})
  assert.deepEqual(pickCandidates(env, 'auto'), [])
  await assert.rejects(() => routeModel(env, REQ, { ...quiet, call: f.call, health: createHealthMonitor() }), (e) => e.kind === 'not_ready' && e.attempts === 0)
  assert.deepEqual(names(f), [])
})
test('no valid Gemini or OpenRouter provider makes zero bounded attempts', async () => {
  const env = { AI_PROVIDER: 'anthropic', AI_API_KEY: 'legacy-key' }
  const f = fake({})
  assert.deepEqual(pickCandidates(env, 'auto'), [])
  await assert.rejects(() => routeModel(env, REQ, { ...quiet, call: f.call, health: createHealthMonitor() }), (e) => e.kind === 'not_ready' && e.attempts === 0)
  assert.deepEqual(names(f), [])
})
test('automatic selection keeps Gemini primary even when AI_PROVIDER names OpenRouter', () => {
  assert.deepEqual(pickCandidates({ ...BOTH, AI_PROVIDER: 'openrouter' }, 'auto').map((cfg) => cfg.name), ['gemini', 'openrouter'])
})
test('automatic selection uses only Gemini and OpenRouter when either is configured', () => {
  const env = { ...BOTH, AI_PROVIDER: 'anthropic', AI_API_KEY: 'legacy-key' }
  assert.deepEqual(pickCandidates(env, 'auto').map((cfg) => cfg.name), ['gemini', 'openrouter'])
})
test('missing OpenRouter credentials: reported safely, Gemini still serves', async () => {
  assert.equal(resolveNamed('openrouter', { GEMINI_API_KEY: G }).status, 'not_configured')
  assert.equal(resolveNamed('openrouter', { OPENROUTER_API_KEY: O }).missing, 'OPENROUTER_MODEL') // no guessed model
  assert.equal(resolveNamed('openrouter', { OPENROUTER_MODEL: 'a/b' }).missing, 'OPENROUTER_API_KEY')
  const f = fake({ gemini: [new ProviderError('provider_status_500'), new ProviderError('provider_status_500')] })
  await assert.rejects(() => routeModel({ GEMINI_API_KEY: G }, REQ, { ...quiet, call: f.call, health: createHealthMonitor() }), (e) => e.kind === 'server' && !e.bothFailed)
  assert.deepEqual(availability({ GEMINI_API_KEY: G }).map((p) => p.name), ['gemini'])
})
test('both providers failing: a safe error, bounded attempts, nothing reported as success', async () => {
  const boom = () => new ProviderError('provider_status_500')
  const f = fake({ gemini: [boom(), boom()], openrouter: [boom(), boom()] })
  await assert.rejects(() => routeModel(BOTH, REQ, { ...quiet, call: f.call, health: createHealthMonitor() }), (e) => e.bothFailed === true && e.attempts === 4 && !/secret/.test(JSON.stringify([e.message, e.tried])))
  assert.equal(f.calls.length, 4)
})
test('a timeout is never returned as a successful answer', async () => {
  const f = fake({ gemini: [new ProviderError('timeout')], openrouter: [new ProviderError('timeout'), new ProviderError('timeout')] })
  await assert.rejects(() => routeModel(BOTH, REQ, { ...quiet, call: f.call, health: createHealthMonitor() }), (e) => e.kind === 'timeout')
})
test('malformed provider response (empty / bad JSON) is a failure, not an answer', async () => {
  const realFetch = globalThis.fetch
  try {
    for (const body of [{}, { choices: [] }, { choices: [{ message: { content: '' } }] }, { error: { code: 502 } }]) {
      globalThis.fetch = async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => body })
      await assert.rejects(() => openrouter.call({ apiKey: O, model: 'a/b', maxTokens: 10, system: 's', messages: [] }), ProviderError)
    }
    globalThis.fetch = async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => { throw new Error('bad json') } })
    await assert.rejects(() => openrouter.call({ apiKey: O, model: 'a/b', maxTokens: 10, system: 's', messages: [] }), (e) => e.kind === 'malformed')
  } finally { globalThis.fetch = realFetch }
})
test('explicit selection: no silent switching; explicit OpenRouter never calls Gemini', async () => {
  const f = fake({ gemini: [new ProviderError('provider_status_500'), new ProviderError('provider_status_500')] })
  await assert.rejects(() => routeModel(BOTH, REQ, { ...quiet, selection: 'gemini', call: f.call, health: createHealthMonitor() }), (e) => e.kind === 'server')
  assert.deepEqual(names(f), ['gemini', 'gemini']) // its own bounded retry only
  const f2 = fake({})
  const r = await routeModel(BOTH, REQ, { ...quiet, selection: 'openrouter', call: f2.call, health: createHealthMonitor() })
  assert.deepEqual(names(f2), ['openrouter']); assert.equal(r.fallbackUsed, false)
  await assert.rejects(() => routeModel({ GEMINI_API_KEY: G }, REQ, { ...quiet, selection: 'openrouter', call: fake({}).call }), (e) => e.kind === 'not_ready')
  assert.equal(pickCandidates(BOTH, 'bogus')[0].name, 'gemini') // unknown value = automatic
})
test('history, system prompt and language are identical on both attempts; outputs are never merged', async () => {
  const history = [{ role: 'user', content: 'Habari' }, { role: 'assistant', content: 'Nzuri!' }, { role: 'user', content: 'Nipe mpango wa wiki' }]
  const req = { system: 'Reply in Kiswahili.', messages: history, tools: [{ name: 't' }], maxTokens: 500 }
  const f = fake({ gemini: [new ProviderError('timeout')] })
  const r = await routeModel(BOTH, req, { ...quiet, call: f.call, health: createHealthMonitor() })
  assert.equal(f.calls.length, 2)
  for (const c of f.calls) { assert.equal(c.req.system, req.system); assert.deepEqual(c.req.messages, history); assert.equal(c.req.maxTokens, 500) }
  assert.equal(r.result.text, 'openrouter answer') // exactly one provider's complete text
})
test('long responses pass through whole', async () => {
  const long = 'Karibu. '.repeat(3000)
  const r = await routeModel(BOTH, REQ, { ...quiet, call: fake({ gemini: [ok(long)] }).call, health: createHealthMonitor() })
  assert.equal(r.result.text.length, long.length)
})
test('deadline: no new attempt starts when too little time remains', async () => {
  const c = clock()
  const slow = async (cfg) => { c.t += 21_000; throw new ProviderError('provider_status_500') }
  let n = 0
  const call = async (...a) => { n++; return slow(...a) }
  await assert.rejects(() => routeModel(BOTH, REQ, { ...quiet, now: c.now, call, health: createHealthMonitor({ now: c.now }) }))
  assert.equal(n, 1) // 22s budget, first attempt used 21s: no retry and no fallback attempt is started
})
test('per-attempt timeout never exceeds the remaining deadline', async () => {
  const c = clock(); const seen = []
  const call = async (cfg, req) => { seen.push(req.timeoutMs); c.t += 100; return ok('x') }
  await routeModel(BOTH, REQ, { ...quiet, now: c.now, call, health: createHealthMonitor({ now: c.now }) })
  assert.ok(seen[0] <= routerLimits(BOTH).totalMs)
  assert.ok(routerLimits({ AI_TOTAL_DEADLINE_MS: '999999' }).totalMs <= 27000) // can never be configured past the 30s platform limit
})
test('user cancellation stops routing and does not try the other provider', async () => {
  const ac = new AbortController()
  const call = async () => { ac.abort(); throw new ProviderError('cancelled', 'cancelled') }
  await assert.rejects(() => routeModel(BOTH, REQ, { ...quiet, signal: ac.signal, call, health: createHealthMonitor() }), (e) => e.kind === 'cancelled')
})
test('cooldown and recovery: provider is skipped after repeated failures, probed once, then returns', async () => {
  const c = clock(); const health = createHealthMonitor({ now: c.now })
  const boom = () => new ProviderError('provider_status_500')
  for (let i = 0; i < 2; i++) await routeModel(BOTH, REQ, { ...quiet, now: c.now, call: fake({ gemini: [boom(), boom()] }, c).call, health }) // 2 failed Gemini attempts each, OpenRouter answers
  assert.equal(health.statusOf('gemini'), 'cooldown')
  const skip = fake({}, c)
  await routeModel(BOTH, REQ, { ...quiet, now: c.now, call: skip.call, health })
  assert.deepEqual(names(skip), ['openrouter']) // skipped while cooling down
  c.t += 400_000 // cooldown is bounded (<= 5 min), never permanent
  const probe = fake({}, c)
  const r = await routeModel(BOTH, REQ, { ...quiet, now: c.now, call: probe.call, health })
  assert.equal(r.provider, 'gemini'); assert.equal(health.statusOf('gemini'), 'healthy')
})
test('half-open allows a single probe at a time', () => {
  const c = clock(); const h = createHealthMonitor({ now: c.now })
  for (let i = 0; i < 3; i++) h.recordFailure('gemini', 'server')
  c.t += 400_000
  assert.equal(h.acquire('gemini').probe, true)
  assert.equal(h.acquire('gemini').allowed, false)
  h.recordFailure('gemini', 'server') // failed probe -> new bounded cooldown
  assert.equal(h.acquire('gemini').allowed, false)
})
test('health snapshot exposes counters and timings only, never keys', async () => {
  const h = createHealthMonitor()
  await routeModel(BOTH, REQ, { ...quiet, call: fake({}).call, health: h, correlationId: 'cid-1' })
  const snap = JSON.stringify(h.snapshot(['gemini']))
  assert.ok(snap.includes('cid-1') && snap.includes('avgLatencyMs'))
  assert.ok(!snap.includes(G) && !snap.includes(O) && !snap.includes('habari'))
})
test('logs carry provider/duration/outcome/failure/fallback/correlation id but no key and no message text', async () => {
  const lines = []
  await routeModel(BOTH, { ...REQ, messages: [{ role: 'user', content: 'MY-PRIVATE-QUESTION' }] }, { ...quiet, logger: (e) => lines.push(JSON.stringify(e)), call: fake({ gemini: [new ProviderError('provider_status_503'), new ProviderError('provider_status_503')] }).call, health: createHealthMonitor() })
  const all = lines.join('\n')
  assert.match(all, /"provider":"gemini"/); assert.match(all, /"failureKind":"server"/); assert.match(all, /"httpStatus":503/)
  assert.match(all, /"fallbackAttempted":true/); assert.match(all, /"fallbackSucceeded":true/)
  assert.match(all, /"cid":"ai_/); assert.match(all, /"durationMs"/); assert.match(all, /"requestDurationMs"/)
  assert.ok(!all.includes('MY-PRIVATE-QUESTION') && !all.includes(G) && !all.includes(O))
})
test('OpenRouter adapter: fixed upstream URL, bearer key, parses text and drops malformed tool calls', async () => {
  const realFetch = globalThis.fetch; let seen
  globalThis.fetch = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, headers: new Headers(), json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: ' Sawa ', tool_calls: [{ function: { name: 'create_task', arguments: '{"title":"X"}' } }, { function: { name: 'create_task', arguments: '{bad' } }] } }] }) } }
  try {
    const r = await openrouter.call({ apiKey: O, model: 'vendor/m:free', maxTokens: 50, system: 'S', messages: [{ role: 'user', content: 'hi' }], tools: [] })
    assert.equal(seen.url, 'https://openrouter.ai/api/v1/chat/completions')
    assert.equal(seen.init.headers.authorization, `Bearer ${O}`)
    assert.equal(JSON.parse(seen.init.body).messages[0].content, 'S')
    assert.equal(r.text, 'Sawa'); assert.equal(r.toolCalls.length, 1)
    await assert.rejects(() => openrouter.call({ apiKey: O, model: 'https://evil.example/x', maxTokens: 1, system: '', messages: [] }), (e) => e.kind === 'model')
  } finally { globalThis.fetch = realFetch }
})
test('Retry-After header from OpenRouter is carried on the error', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 429, headers: new Headers({ 'retry-after': '2' }), json: async () => ({}) })
  try { await assert.rejects(() => openrouter.call({ apiKey: O, model: 'a/b', maxTokens: 1, system: '', messages: [] }), (e) => e.kind === 'rate_limit' && e.retryAfterMs === 2000) } finally { globalThis.fetch = realFetch }
})
test('status endpoint lists only configured providers and never leaks keys', async () => {
  const env = { ...BOTH, VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' }
  const res = await handleAiRequest(new Request('https://app.example/api/ai-chat?status=1'), env)
  const text = await res.text(); const body = JSON.parse(text)
  assert.deepEqual(body.providers.map((p) => p.name), ['gemini', 'openrouter'])
  assert.ok(!text.includes(G) && !text.includes(O))
  const only = await (await handleAiRequest(new Request('https://app.example/api/ai-chat?status=1'), { GEMINI_API_KEY: G })).json()
  assert.deepEqual(only.providers.map((p) => p.name), ['gemini'])
  const orOnly = await (await handleAiRequest(new Request('https://app.example/api/ai-chat?status=1'), { OPENROUTER_API_KEY: O, OPENROUTER_MODEL: 'a/b' })).json()
  assert.equal(orOnly.configured, true)
  const legacyOnly = await (await handleAiRequest(new Request('https://app.example/api/ai-chat?status=1'), { AI_API_KEY: 'legacy-key' })).json()
  assert.equal(legacyOnly.configured, false)
  assert.equal(legacyOnly.provider, 'gemini')
  assert.deepEqual(legacyOnly.providers, [])
})
test('diagnostics: no token = 401, and the endpoint is not open to the public', async () => {
  const env = { ...BOTH, VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' }
  assert.equal((await handleAiRequest(new Request('https://app.example/api/ai-chat?diagnostics=1'), env)).status, 401)
})
