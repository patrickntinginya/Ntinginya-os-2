// End-to-end through the REAL handler (auth + routing + provider adapters + persistence), with only the outside world faked:
// Supabase (a recording stand-in) and the two providers' HTTP endpoints. No network, no paid calls.
import assert from 'node:assert/strict'
import test from 'node:test'
import { handleAiRequest } from '../api/_lib/ai/handler.js'
import { routeModel } from '../api/_lib/ai/router.js'
import { createHealthMonitor } from '../api/_lib/ai/health.js'
import { ProviderError } from '../api/_lib/ai/provider.js'
import { AI_SELECTIONS, effectiveSelection, getAiSelection, normalizeAiSelection, selectableProviders, setAiSelection } from '../src/lib/aiProvider.js'

const G = 'AIza-SECRET-gemini-123', O = 'sk-or-SECRET-456'
const ENV = { GEMINI_API_KEY: G, OPENROUTER_API_KEY: O, OPENROUTER_MODEL: 'vendor/free-model:free', VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' }
const CONV = '11111111-1111-4111-8111-111111111111'
const USER = { id: 'u1', app_metadata: {}, user_metadata: {} }
let seq = 0 // each request is a different user so the per-user burst limiter (8/min) does not interfere with the tests

// Recording stand-in for the Supabase client: every query chain resolves; inserts are recorded.
function fakeClient(rec, options = {}) {
  const make = (table) => {
    rec.queries.push(table)
    const st = { table, op: 'select', head: false, one: false }
    const result = () => {
      if (st.op === 'insert') return { data: table === 'ai_conversations' ? { id: CONV } : table === 'ai_action_requests' ? [] : null, error: null }
      if (st.op === 'update') return { data: null, error: null }
      if (table === 'profiles') return { data: options.profileData === undefined ? { ai_enabled: true } : options.profileData, error: options.profileError || null }
      if (table === 'ai_messages' && st.head) return { data: null, count: 0, error: null }
      if (table === 'ai_messages') return { data: [{ role: 'assistant', content: 'Nzuri!' }, { role: 'user', content: 'Habari' }], error: null } // newest first, like the real query
      if (table === 'ai_conversations') return { data: { id: CONV }, error: null }
      return { data: st.one ? null : [], count: 0, error: null }
    }
    const p = new Proxy(function () {}, {
      get(_, prop) {
        if (prop === 'then') return (res, rej) => Promise.resolve(result()).then(res, rej)
        return (...args) => {
          if (prop === 'insert') { st.op = 'insert'; rec.inserts.push({ table, rows: args[0] }) }
          else if (prop === 'update') st.op = 'update'
          else if (prop === 'select' && args[1]?.head) st.head = true
          else if (prop === 'single' || prop === 'maybeSingle') st.one = true
          return p
        }
      },
    })
    return p
  }
  return {
    from: make,
    async rpc(name) {
      rec.rpcs.push(name)
      if (name === 'consume_ai_request' || name === 'consume_ai_ping') {
        if (options.usageThrows) throw options.usageThrows
        if (options.usageError) return { data: null, error: options.usageError }
        return { data: options.usageData || [{ allowed: true, reason: null }], error: null }
      }
      return { data: [], error: null }
    },
  }
}

const geminiOk = (text) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] } })
const orOk = (text) => ({ status: 200, body: { choices: [{ message: { content: text }, finish_reason: 'stop' }] } })
const status = (s, headers = {}) => ({ status: s, body: { error: { message: 'PROVIDER-DETAIL-MUST-NOT-LEAK', status: s === 429 ? 'RESOURCE_EXHAUSTED' : 'X' } }, headers })
const abort = () => ({ throws: Object.assign(new Error('aborted'), { name: 'AbortError' }) })

/** Runs one POST /api/ai-chat with scripted provider behaviour. script.gemini / script.openrouter: steps consumed in order. */
async function ask({ env = ENV, script = {}, body = {}, health = createHealthMonitor(), user = USER, clientOptions = {} } = {}) {
  const rec = { inserts: [], calls: [], queries: [], rpcs: [] }
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const which = String(url).includes('generativelanguage.googleapis.com') ? 'gemini' : String(url).includes('openrouter.ai') ? 'openrouter' : 'other'
    rec.calls.push({ which, url: String(url), headers: init?.headers, body: init?.body ? JSON.parse(init.body) : null })
    assert.notEqual(which, 'other', `unexpected outbound request to ${url}`)
    const step = (script[which] || []).shift() ?? (which === 'gemini' ? geminiOk('gemini answer') : orOk('openrouter answer'))
    if (step.throws) throw step.throws
    return new Response(JSON.stringify(step.body), { status: step.status, headers: { 'content-type': 'application/json', ...(step.headers || {}) } })
  }
  try {
    const request = new Request('https://app.example/api/ai-chat', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Nipe mpango wa wiki', mode: 'chat', today: '2026-10-30', lang: 'sw', conversation_id: CONV, ...body }),
    })
    const deps = {
      authenticate: async () => ({ client: fakeClient(rec, clientOptions), user: { ...user, id: `user-${++seq}` } }),
      health,
      logger: () => {},
      route: (e, req, opts) => routeModel(e, req, { ...opts, sleep: async () => {}, random: () => 0 }), // no real waiting in tests
    }
    const res = await handleAiRequest(request, env, deps)
    const text = await res.text()
    return { res, text, json: JSON.parse(text), rec, health, count: (w) => rec.calls.filter((c) => c.which === w).length }
  } finally { globalThis.fetch = real }
}
const messageInserts = (rec) => rec.inserts.filter((i) => i.table === 'ai_messages')
const assertSafe = (text) => { for (const secret of [G, O, 'PROVIDER-DETAIL-MUST-NOT-LEAK']) assert.ok(!text.includes(secret), `leaked ${secret}`) }

test('AI disabled, missing profile, and profile read errors fail closed before provider calls', async () => {
  const disabled = await ask({ clientOptions: { profileData: { ai_enabled: false } } })
  assert.equal(disabled.res.status, 403)
  assert.equal(disabled.rec.rpcs.length, 0)
  assert.equal(disabled.rec.calls.length, 0)

  for (const clientOptions of [
    { profileData: null },
    { profileData: { ai_enabled: null } },
    { profileError: new Error('profile lookup unavailable') },
  ]) {
    const unavailable = await ask({ clientOptions })
    assert.equal(unavailable.res.status, 503)
    assert.equal(unavailable.json.error, 'ai_settings_unavailable')
    assert.equal(unavailable.rec.rpcs.length, 0)
    assert.equal(unavailable.rec.calls.length, 0)
  }
})

test('usage database errors, malformed replies, and quota rejections prevent provider calls', async () => {
  const unavailableCases = [
    { usageError: new Error('database unavailable') },
    { usageThrows: new Error('RPC failed') },
    { usageData: [{ allowed: 'yes' }] },
    { usageData: [] },
  ]
  for (const clientOptions of unavailableCases) {
    const unavailable = await ask({ clientOptions })
    assert.equal(unavailable.res.status, 503)
    assert.equal(unavailable.json.error, 'usage_limit_unavailable')
    assert.equal(unavailable.rec.calls.length, 0)
  }

  for (const reason of ['daily_limit', 'burst_limit']) {
    const limited = await ask({ clientOptions: { usageData: [{ allowed: false, reason }] } })
    assert.equal(limited.res.status, 429)
    assert.equal(limited.json.error, reason)
    assert.equal(limited.rec.calls.length, 0)
  }
})

test('personal context is not queried by default and only selected categories are sent', async () => {
  const defaultRequest = await ask()
  const privateTables = ['tasks', 'reminders', 'schedule_events', 'goals', 'milestones', 'projects', 'habits', 'habit_entries', 'learning_items', 'study_sessions', 'budgets', 'financial_goals', 'income', 'expenses', 'ideas']
  assert.equal(defaultRequest.res.status, 200)
  assert.equal(privateTables.some((table) => defaultRequest.rec.queries.includes(table)), false)
  const defaultConversation = JSON.stringify(defaultRequest.rec.calls[0].body.contents)
  assert.ok(!defaultConversation.includes('<user_data>'))

  const selectedRequest = await ask({ body: { context_categories: ['tasks', 'malicious_category'] } })
  assert.equal(selectedRequest.res.status, 200)
  assert.ok(selectedRequest.rec.queries.includes('tasks'))
  assert.ok(selectedRequest.rec.queries.includes('reminders'))
  assert.equal(selectedRequest.rec.queries.includes('income'), false)
  assert.equal(selectedRequest.rec.queries.includes('budgets'), false)
  const selectedUserTurn = JSON.stringify(selectedRequest.rec.calls[0].body.contents)
  assert.match(selectedUserTurn, /<user_data>/)
  assert.ok(selectedUserTurn.includes('tasks'))
  assert.ok(!selectedUserTurn.includes('finance'))
})

test('primary success: Gemini answers, OpenRouter is never contacted, one exchange is stored', async () => {
  const r = await ask()
  assert.equal(r.res.status, 200); assert.equal(r.json.reply, 'gemini answer'); assert.equal(r.json.provider, 'gemini'); assert.equal(r.json.fallback_used, false)
  assert.equal(r.count('gemini'), 1); assert.equal(r.count('openrouter'), 0)
  assert.equal(messageInserts(r.rec).length, 1); assert.equal(messageInserts(r.rec)[0].rows.length, 2)
  assertSafe(r.text)
})

test('a new conversation is created only after a provider returns a complete answer', async () => {
  const failed = await ask({ body: { conversation_id: null }, script: { gemini: [status(500), status(500)], openrouter: [status(500), status(500)] } })
  assert.notEqual(failed.res.status, 200)
  assert.equal(failed.rec.inserts.some((i) => i.table === 'ai_conversations'), false)

  const succeeded = await ask({ body: { conversation_id: null } })
  assert.equal(succeeded.res.status, 200)
  assert.equal(succeeded.rec.inserts.filter((i) => i.table === 'ai_conversations').length, 1)
  assert.equal(messageInserts(succeeded.rec).length, 1)
})

test('timeout: falls back to OpenRouter once; the answer is OpenRouter\'s alone and is stored exactly once', async () => {
  const r = await ask({ script: { gemini: [abort()] } })
  assert.equal(r.res.status, 200); assert.equal(r.json.reply, 'openrouter answer'); assert.equal(r.json.provider, 'openrouter'); assert.equal(r.json.fallback_used, true)
  assert.equal(r.count('gemini'), 1); assert.equal(r.count('openrouter'), 1)
  assert.equal(messageInserts(r.rec).length, 1)
  assert.equal(r.rec.rpcs.filter((name) => name === 'consume_ai_request').length, 1)
  assert.equal(messageInserts(r.rec)[0].rows.find((m) => m.role === 'assistant').content, 'openrouter answer')
})

test('HTTP 429 without Retry-After: immediate fallback, no hammering of Gemini', async () => {
  const r = await ask({ script: { gemini: [status(429)] } })
  assert.equal(r.json.provider, 'openrouter'); assert.equal(r.count('gemini'), 1)
})

test('HTTP 503: one bounded retry on Gemini, then OpenRouter (never a third Gemini call)', async () => {
  const r = await ask({ script: { gemini: [status(503), status(503), status(503)] } })
  assert.equal(r.count('gemini'), 2); assert.equal(r.count('openrouter'), 1); assert.equal(r.json.provider, 'openrouter')
  assert.equal(r.rec.rpcs.filter((name) => name === 'consume_ai_request').length, 1)
  assert.equal(messageInserts(r.rec).length, 1)
})

test('HTTP 503 once: the retry succeeds and OpenRouter is not used', async () => {
  const r = await ask({ script: { gemini: [status(503), geminiOk('recovered')] } })
  assert.equal(r.json.reply, 'recovered'); assert.equal(r.count('gemini'), 2); assert.equal(r.count('openrouter'), 0); assert.equal(r.json.fallback_used, false)
  assert.equal(r.rec.rpcs.filter((name) => name === 'consume_ai_request').length, 1)
  assert.equal(messageInserts(r.rec).length, 1)
})

test('a malformed Gemini 200 response is treated as failure and automatically falls back', async () => {
  const malformed = { status: 200, body: { candidates: [] } }
  const r = await ask({ script: { gemini: [malformed, malformed] } })
  assert.equal(r.res.status, 200)
  assert.equal(r.json.provider, 'openrouter')
  assert.equal(r.json.reply, 'openrouter answer')
  assert.equal(r.count('gemini'), 2)
  assert.equal(r.count('openrouter'), 1)
  assert.equal(messageInserts(r.rec).length, 1)
})

test('invalid Gemini key: not retried, OpenRouter answers, and the next request skips Gemini during cooldown', async () => {
  const health = createHealthMonitor()
  const first = await ask({ script: { gemini: [status(401)] }, health })
  assert.equal(first.json.provider, 'openrouter'); assert.equal(first.count('gemini'), 1)
  const second = await ask({ health })
  assert.equal(second.count('gemini'), 0); assert.equal(second.json.provider, 'openrouter')
  assertSafe(first.text + second.text)
})

test('Gemini misconfigured (no key) but OpenRouter configured: OpenRouter serves', async () => {
  const { GEMINI_API_KEY, ...env } = ENV
  const r = await ask({ env })
  assert.equal(r.res.status, 200); assert.equal(r.json.provider, 'openrouter'); assert.equal(r.count('gemini'), 0)
})

test('missing secondary credentials: Gemini failure is reported safely and OpenRouter is never contacted', async () => {
  const { OPENROUTER_API_KEY, OPENROUTER_MODEL, ...env } = ENV
  const r = await ask({ env, script: { gemini: [status(500), status(500)] } })
  assert.equal(r.res.status, 502); assert.equal(r.json.error, 'ai_provider_error'); assert.equal(r.count('openrouter'), 0)
  assert.equal(messageInserts(r.rec).length, 0)
  assertSafe(r.text)
})

test('both providers failing: friendly code, bounded attempts, correlation id, nothing stored, nothing leaked', async () => {
  const r = await ask({ body: { conversation_id: null }, script: { gemini: [status(500), status(500)], openrouter: [status(500), status(500)] } })
  assert.equal(r.res.status, 502); assert.equal(r.json.error, 'ai_provider_error'); assert.match(r.json.request_id, /^ai_/)
  assert.equal(r.count('gemini') + r.count('openrouter'), 4)
  assert.equal(messageInserts(r.rec).length, 0) // the question is not saved as an exchange; the browser keeps it for a retry
  assert.equal(r.rec.inserts.some((i) => i.table === 'ai_conversations'), false)
  assert.equal(r.rec.rpcs.filter((name) => name === 'consume_ai_request').length, 1)
  assert.equal(r.json.reply, undefined); assertSafe(r.text)
})

test('both providers timing out: 504 ai_timeout, never a success', async () => {
  const r = await ask({ script: { gemini: [abort()], openrouter: [abort(), abort()] } })
  assert.equal(r.res.status, 504); assert.equal(r.json.error, 'ai_timeout'); assert.equal(r.json.reply, undefined)
})

test('both providers rate limited: 429 with a translated code', async () => {
  const r = await ask({ script: { gemini: [status(429)], openrouter: [status(429), status(429)] } })
  assert.equal(r.res.status, 429); assert.equal(r.json.error, 'provider_rate_limited')
})

test('malformed OpenRouter reply after a Gemini failure is an error, not an answer', async () => {
  const r = await ask({ script: { gemini: [status(500), status(500)], openrouter: [{ status: 200, body: { choices: [] } }, { status: 200, body: { choices: [] } }] } })
  assert.notEqual(r.res.status, 200); assert.equal(r.json.reply, undefined)
})

test('explicit selection: "openrouter" never calls Gemini; "gemini" never silently switches', async () => {
  const a = await ask({ body: { provider: 'openrouter' } })
  assert.equal(a.json.provider, 'openrouter'); assert.equal(a.count('gemini'), 0)
  const b = await ask({ body: { provider: 'gemini' }, script: { gemini: [status(500), status(500)] } })
  assert.equal(b.res.status, 502); assert.equal(b.count('openrouter'), 0)
  const c = await ask({ body: { provider: 'openrouter' }, env: { ...ENV, OPENROUTER_API_KEY: '' } })
  assert.equal(c.res.status, 503); assert.equal(c.json.error, 'ai_not_configured'); assert.equal(c.count('gemini'), 0)
})

test('a hostile provider value cannot pick an upstream address: it is treated as automatic', async () => {
  const r = await ask({ body: { provider: 'https://evil.example/v1', base_url: 'https://evil.example', model: 'evil' } })
  assert.equal(r.json.provider, 'gemini'); assert.ok(r.rec.calls.every((c) => c.which !== 'other'))
})

test('conversation history, system prompt and language are identical on the fallback attempt', async () => {
  const r = await ask({ script: { gemini: [status(401)] } })
  const g = r.rec.calls.find((c) => c.which === 'gemini').body
  const o = r.rec.calls.find((c) => c.which === 'openrouter').body
  // Gemini: systemInstruction + contents (assistant is "model"); OpenRouter: system message + messages.
  assert.equal(o.messages[0].role, 'system'); assert.equal(o.messages[0].content, g.systemInstruction.parts[0].text)
  assert.match(o.messages[0].content, /Kiswahili/i)
  assert.deepEqual(o.messages.slice(1, 3).map((m) => [m.role, m.content]), [['user', 'Habari'], ['assistant', 'Nzuri!']])
  const lastUser = o.messages[o.messages.length - 1]
  assert.equal(lastUser.role, 'user'); assert.ok(lastUser.content.endsWith('User message: Nipe mpango wa wiki'))
  assert.equal(g.contents[0].parts[0].text, 'Habari'); assert.equal(g.contents[1].role, 'model')
  assert.equal(o.max_tokens, g.generationConfig.maxOutputTokens)
})

test('long answers pass through whole from either provider', async () => {
  const long = 'Kila siku, hatua ndogo. '.repeat(400)
  const a = await ask({ script: { gemini: [geminiOk(long)] } })
  assert.equal(a.json.reply, long.trim())
  const b = await ask({ script: { gemini: [abort()], openrouter: [orOk(long)] } })
  assert.equal(b.json.reply, long.trim()); assert.equal(messageInserts(b.rec)[0].rows[1].content, long.trim())
})

test('connection test uses the router with no retries and reports honestly', async () => {
  const ok = await ask({ body: { mode: 'ping' } })
  assert.equal(ok.res.status, 200); assert.equal(ok.json.ok, true)
  assert.equal(ok.rec.rpcs.filter((name) => name === 'consume_ai_ping').length, 1)
  assert.equal(ok.rec.rpcs.filter((name) => name === 'consume_ai_request').length, 0)
  const bad = await ask({ body: { mode: 'ping', provider: 'gemini' }, script: { gemini: [status(500), status(500)] } })
  assert.equal(bad.res.status, 502); assert.equal(bad.count('gemini'), 1); assert.equal(bad.rec.inserts.length, 0)
})

test('streaming guard: once partial text was sent, there is no retry and no provider switch', async () => {
  let calls = 0
  const call = async () => { calls++; throw new ProviderError('provider_status_500') }
  await assert.rejects(
    () => routeModel(ENV, { system: 's', messages: [] }, { call, health: createHealthMonitor(), logger: () => {}, sleep: async () => {}, partialSent: () => true }),
    (e) => e.partial === true && e.attempts === 1,
  )
  assert.equal(calls, 1)
})

test('diagnostics: administrators only, taken from verified app_metadata, and never contain secrets', async () => {
  const health = createHealthMonitor(); health.recordFailure('gemini', 'server'); health.recordSuccess('openrouter', 420)
  const get = (user, token = 'tok') => handleAiRequest(
    new Request('https://app.example/api/ai-chat?diagnostics=1', { headers: token ? { authorization: `Bearer ${token}` } : {} }),
    ENV, { authenticate: async () => (user ? { client: {}, user } : null), health },
  )
  assert.equal((await get(null, '')).status, 401)
  assert.equal((await get(null)).status, 401)                                  // token rejected by Supabase
  assert.equal((await get(USER)).status, 403)                                  // ordinary user
  assert.equal((await get({ ...USER, user_metadata: { role: 'admin' } })).status, 403) // user-editable metadata is NOT trusted
  const res = await get({ ...USER, app_metadata: { role: 'admin' } })
  assert.equal(res.status, 200)
  const text = await res.text(); const body = JSON.parse(text)
  assertSafe(text)
  assert.deepEqual(body.providers.map((p) => p.name), ['gemini', 'openrouter'])
  assert.equal(body.providers[1].avgLatencyMs, 420); assert.ok(body.limits.totalMs <= 27000)
  assert.ok(!/apiKey|authorization|message|prompt/i.test(JSON.stringify(body.recent)))
})

test('hosting deadline: default budget stays under the 30 s function limit', async () => {
  const { routerLimits } = await import('../api/_lib/ai/router.js')
  assert.ok(routerLimits({}).totalMs <= 27000 && routerLimits({ AI_TOTAL_DEADLINE_MS: '999999' }).totalMs <= 27000)
  const vercel = JSON.parse((await import('node:fs')).readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  assert.ok(vercel.functions['api/ai-chat.js'].maxDuration >= 30)
})

test('browser preference helper: only known values, remembered, unavailable providers fall back to automatic', () => {
  const mem = () => { const d = {}; return { getItem: (k) => d[k] ?? null, setItem: (k, v) => { d[k] = v } } }
  const s = mem()
  assert.equal(getAiSelection(s), 'auto')
  assert.equal(setAiSelection('openrouter', s), 'openrouter'); assert.equal(getAiSelection(s), 'openrouter')
  assert.equal(setAiSelection('https://evil.example', s), 'auto')
  assert.deepEqual(AI_SELECTIONS, ['auto', 'gemini', 'openrouter']); assert.equal(normalizeAiSelection(undefined), 'auto')
  const only = { providers: [{ name: 'gemini' }] }
  assert.deepEqual(selectableProviders(only), ['auto', 'gemini']); assert.equal(effectiveSelection('openrouter', only), 'auto')
  assert.deepEqual(selectableProviders({ providers: [] }), [])
  assert.equal(getAiSelection({ getItem() { throw new Error('blocked') } }), 'auto')
})
