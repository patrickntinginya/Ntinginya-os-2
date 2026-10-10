import assert from 'node:assert/strict'
import test from 'node:test'
import { callModel, publicStatus, resolveProvider, ProviderError } from '../netlify/lib/ai/provider.js'
import { toGeminiContents, toGeminiSchema, toGeminiTools, GEMINI_DEFAULT_MODEL } from '../netlify/lib/ai/providers/gemini.js'
import { providerErrorReply, FALLBACK_MESSAGES } from '../netlify/lib/ai/http.js'
import { dailyLimitReached, makeBurstLimiter } from '../netlify/lib/ai/limits.js'
import { systemPrompt } from '../netlify/lib/ai/prompts.js'
import { toolDefinitions, validateAction } from '../src/lib/ai/actions.js'

const KEY = 'AIza-super-secret-key-123'

test('Gemini is the default provider', () => {
  assert.equal(resolveProvider({ GEMINI_API_KEY: KEY }).name, 'gemini')
  assert.equal(resolveProvider({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: KEY }).status, 'ready')
  assert.equal(resolveProvider({}).name, 'gemini')
})
test('legacy V3 setups keep working: AI_API_KEY alone still means anthropic', () => {
  assert.equal(resolveProvider({ AI_API_KEY: 'k' }).name, 'anthropic')
  assert.equal(resolveProvider({ AI_PROVIDER: 'gemini', AI_API_KEY: 'k' }).status, 'not_configured') // gemini does not use AI_API_KEY
})
test('model comes from GEMINI_MODEL, otherwise the documented stable default', () => {
  assert.equal(resolveProvider({ GEMINI_API_KEY: KEY }).model, GEMINI_DEFAULT_MODEL)
  assert.equal(GEMINI_DEFAULT_MODEL, 'gemini-3.1-flash-lite')
  assert.equal(resolveProvider({ GEMINI_API_KEY: KEY, GEMINI_MODEL: 'my-model-1' }).model, 'my-model-1')
  assert.equal(resolveProvider({ GEMINI_API_KEY: KEY, GEMINI_MODEL: '../../evil?x=1' }).status, 'not_configured')
})
test('missing Gemini key: not configured, no crash, callModel refuses instead of faking an answer', async () => {
  const cfg = resolveProvider({ AI_PROVIDER: 'gemini' })
  assert.equal(cfg.status, 'not_configured')
  await assert.rejects(() => callModel(cfg, { system: 's', messages: [] }), (e) => e instanceof ProviderError && e.kind === 'not_ready')
})
test('AI_PROVIDER=none turns AI off even with a key', () => assert.equal(resolveProvider({ AI_PROVIDER: 'none', GEMINI_API_KEY: KEY }).status, 'disabled'))
test('daily limit and token limits have safe defaults and bounds', () => {
  assert.equal(resolveProvider({ GEMINI_API_KEY: KEY }).dailyLimit, 100)
  assert.equal(resolveProvider({ GEMINI_API_KEY: KEY, AI_DAILY_LIMIT: '25' }).dailyLimit, 25)
  assert.equal(resolveProvider({ GEMINI_API_KEY: KEY, AI_DAILY_LIMIT: '-5' }).dailyLimit, 100)
  assert.equal(resolveProvider({ GEMINI_API_KEY: KEY, AI_DAILY_LIMIT: '999999' }).dailyLimit, 1000)
  assert.equal(resolveProvider({ GEMINI_API_KEY: KEY, AI_MAX_TOKENS: '99999' }).maxTokens, 4000)
  assert.equal(resolveProvider({ GEMINI_API_KEY: KEY, AI_MAX_TOKENS: '500' }).maxTokens, 500)
})
test('public status exposes provider, model, limit and status but never the key', () => {
  const s = publicStatus(resolveProvider({ GEMINI_API_KEY: KEY, GEMINI_MODEL: 'm1' }))
  assert.deepEqual(s, { provider: 'gemini', status: 'ready', configured: true, model: 'm1', dailyLimit: 100, missing: null })
  assert.ok(!JSON.stringify(s).includes(KEY))
  assert.equal(publicStatus(resolveProvider({})).missing, 'GEMINI_API_KEY') // a variable NAME, not a value
})

async function withFetch(impl, fn) {
  const real = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return impl(url, init) }
  try { return await fn(calls) } finally { globalThis.fetch = real }
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const fail = (status, body = {}) => ({ ok: false, status, json: async () => body })
const cfg = () => resolveProvider({ GEMINI_API_KEY: KEY })

test('request shape: key in header only, system instruction, tools, token limit', async () => {
  await withFetch(() => ok({ candidates: [{ content: { parts: [{ text: 'Habari' }] }, finishReason: 'STOP' }] }), async (calls) => {
    const r = await callModel(cfg(), { system: 'SYS', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'user', content: 'plan' }], tools: toolDefinitions() })
    assert.equal(r.text, 'Habari')
    const { url, init } = calls[0]
    assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.1-flash-lite:generateContent$/)
    assert.ok(!url.includes(KEY) && !url.includes('key='))
    assert.equal(init.headers['x-goog-api-key'], KEY)
    const body = JSON.parse(init.body)
    assert.equal(body.systemInstruction.parts[0].text, 'SYS')
    assert.deepEqual(body.contents.map((c) => c.role), ['user', 'model', 'user'])
    assert.equal(body.generationConfig.maxOutputTokens, 2048)
    assert.equal(body.tools[0].functionDeclarations.length, toolDefinitions().length)
    assert.ok(!JSON.stringify(body).includes(KEY))
  })
})
test('response parsing: text, function calls, thought parts ignored', async () => {
  const body = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'secret thoughts', thought: true }, { text: 'Naweza kuunda kazi.' }, { functionCall: { name: 'create_task', args: { title: 'Lipa kodi' } } }] } }] }
  await withFetch(() => ok(body), async () => {
    const r = await callModel(cfg(), { system: 's', messages: [{ role: 'user', content: 'x' }] })
    assert.equal(r.text, 'Naweza kuunda kazi.')
    assert.deepEqual(r.toolCalls, [{ name: 'create_task', input: { title: 'Lipa kodi' } }])
  })
})
test('a blocked or empty answer returns empty text (never a made-up answer)', async () => {
  await withFetch(() => ok({ promptFeedback: { blockReason: 'SAFETY' } }), async () => {
    const r = await callModel(cfg(), { system: 's', messages: [] })
    assert.equal(r.text, '')
    assert.deepEqual(r.toolCalls, [])
    assert.equal(r.stopReason, 'SAFETY')
  })
})
test('errors are classified: quota, key problems, unknown model, server, timeout, network', async () => {
  const kind = async (impl) => withFetch(impl, async () => callModel(cfg(), { system: 's', messages: [] }).then(() => 'none', (e) => e.kind))
  assert.equal(await kind(() => fail(429)), 'rate_limit')
  assert.equal(await kind(() => fail(400, { error: { status: 'RESOURCE_EXHAUSTED' } })), 'rate_limit')
  assert.equal(await kind(() => fail(403)), 'auth')
  assert.equal(await kind(() => fail(404)), 'model')
  assert.equal(await kind(() => fail(503)), 'server')
  assert.equal(await kind(() => { throw Object.assign(new Error('x'), { name: 'AbortError' }) }), 'timeout')
  assert.equal(await kind(() => { throw new Error('ECONNRESET') }), 'network')
})
test('error messages never contain the key or provider text', async () => {
  await withFetch(() => fail(500, { error: { message: `bad key ${KEY}` } }), async () => {
    await assert.rejects(() => callModel(cfg(), { system: 's', messages: [] }), (e) => !e.message.includes(KEY) && /^provider_status_500$/.test(e.message))
  })
})
test('HTTP mapping: quota -> 429, timeout -> 504, config -> 502, unknown -> 502', () => {
  assert.deepEqual(providerErrorReply({ kind: 'rate_limit' }), { status: 429, error: 'provider_rate_limited' })
  assert.deepEqual(providerErrorReply({ kind: 'timeout' }), { status: 504, error: 'ai_timeout' })
  assert.deepEqual(providerErrorReply({ kind: 'auth' }), { status: 502, error: 'ai_config_error' })
  assert.deepEqual(providerErrorReply({ kind: 'not_ready' }), { status: 503, error: 'ai_not_configured' })
  assert.deepEqual(providerErrorReply(new Error('x')), { status: 502, error: 'ai_provider_error' })
  for (const code of ['provider_rate_limited', 'ai_timeout', 'ai_config_error', 'ai_provider_error', 'daily_limit', 'burst_limit']) assert.ok(FALLBACK_MESSAGES[code])
})
test('rate limiting: daily limit and burst limiter', () => {
  assert.equal(dailyLimitReached(99, 100), false)
  assert.equal(dailyLimitReached(100, 100), true)
  let t = 0
  const l = makeBurstLimiter({ max: 2, windowMs: 1000, now: () => t })
  assert.ok(l.allow('a')); assert.ok(l.allow('a')); assert.equal(l.allow('a'), false)
  assert.ok(l.allow('b'), 'other users are not affected')
  t = 1500
  assert.ok(l.allow('a'), 'allowed again after the window')
})
test('schemas are reduced to the subset Gemini accepts', () => {
  const s = toGeminiSchema({ type: 'object', additionalProperties: false, properties: { a: { type: 'string', maxLength: 5, enum: ['x'] }, b: { type: 'array', items: { type: 'object', properties: { c: { type: 'string', pattern: '.*' } }, required: ['c'] } } }, required: ['a'] })
  assert.deepEqual(s, { type: 'object', properties: { a: { type: 'string', enum: ['x'] }, b: { type: 'array', items: { type: 'object', properties: { c: { type: 'string' } }, required: ['c'] } } }, required: ['a'] })
  assert.equal(toGeminiTools([]), undefined)
  assert.deepEqual(toGeminiContents([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }]), [{ role: 'user', parts: [{ text: 'a\n\nb' }] }])
})
test('the language is passed to the prompt: Kiswahili and English', () => {
  assert.match(systemPrompt('2026-10-07', 'Wednesday', 'sw'), /Kiswahili/)
  assert.match(systemPrompt('2026-10-07', 'Wednesday', 'sw'), /Hakuna data za kutosha bado/)
  assert.match(systemPrompt('2026-10-07', 'Wednesday', 'en'), /English/)
})
test('AI action safety: only create-style actions exist, none delete, and bad payloads are rejected', () => {
  const names = toolDefinitions().map((t) => t.name)
  assert.ok(names.length > 0)
  for (const n of names) assert.ok(!/delete|remove|transfer|send|update/i.test(n), `unsafe action ${n}`)
  assert.equal(validateAction('delete_goal', { id: 'x' }).ok, false)
  assert.equal(validateAction('create_task', {}).ok, false)
  assert.equal(validateAction('create_task', { title: 'Lipa kodi' }).ok, true)
})
