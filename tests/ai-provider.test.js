import assert from 'node:assert/strict'
import test from 'node:test'
import { callModel, publicStatus, resolveProvider, ProviderError } from '../api/_lib/ai/provider.js'
import { toOpenAiTools } from '../api/_lib/ai/providers/openai.js'
import { toolDefinitions } from '../src/lib/ai/actions.js'

test('no provider and no key: gemini is the default but reported as not configured', () => {
  const c = resolveProvider({})
  assert.equal(c.name, 'gemini')
  assert.equal(c.status, 'not_configured')
  assert.equal(c.missing, 'GEMINI_API_KEY')
  assert.equal(c.configured, false)
})
test('AI_PROVIDER=none disables AI even when a key exists', () => assert.equal(resolveProvider({ AI_PROVIDER: 'none', AI_API_KEY: 'k' }).status, 'disabled'))
test('V2 compatibility: a key without AI_PROVIDER means anthropic', () => {
  const c = resolveProvider({ AI_API_KEY: 'k' })
  assert.equal(c.name, 'anthropic')
  assert.equal(c.status, 'ready')
})
test('selecting a provider uses its default model unless AI_MODEL is set', () => {
  assert.equal(resolveProvider({ AI_PROVIDER: 'openai', AI_API_KEY: 'k' }).model, 'gpt-4o-mini')
  assert.equal(resolveProvider({ AI_PROVIDER: 'openai', AI_API_KEY: 'k', AI_MODEL: 'm' }).model, 'm')
})
test('provider named but key missing: not configured, and says which variable', () => {
  const c = resolveProvider({ AI_PROVIDER: 'openai' })
  assert.equal(c.status, 'not_configured')
  assert.equal(c.missing, 'AI_API_KEY')
})
test('ollama needs a base URL, not a key', () => {
  assert.equal(resolveProvider({ AI_PROVIDER: 'ollama' }).missing, 'AI_BASE_URL')
  assert.equal(resolveProvider({ AI_PROVIDER: 'ollama', AI_BASE_URL: 'https://ollama.example.com/v1' }).status, 'ready')
})
test('unknown provider names are reported as unsupported, never silently faked', () => {
  assert.equal(resolveProvider({ AI_PROVIDER: 'banana', AI_API_KEY: 'k' }).status, 'unsupported')
})
test('the public status never contains the key', () => {
  const cfg = resolveProvider({ AI_PROVIDER: 'openai', AI_API_KEY: 'sk-secret-123', AI_BASE_URL: 'https://x.example/v1' })
  const json = JSON.stringify(publicStatus(cfg))
  assert.ok(!json.includes('sk-secret-123') && !json.includes('apiKey') && !json.includes('x.example'))
  assert.deepEqual(Object.keys(publicStatus(cfg)).sort(), ['configured', 'dailyLimit', 'missing', 'model', 'provider', 'status'])
})
test('AI unavailable: callModel refuses to run instead of returning a fake answer', async () => {
  await assert.rejects(() => callModel(resolveProvider({}), { system: 's', messages: [] }), ProviderError)
})
test('tool definitions convert to the OpenAI function format with the same schema', () => {
  const tools = toolDefinitions()
  const converted = toOpenAiTools(tools)
  assert.equal(converted.length, tools.length)
  assert.equal(converted[0].type, 'function')
  assert.deepEqual(converted[0].function.parameters, tools[0].input_schema)
})

async function withFetch(response, fn) {
  const real = globalThis.fetch
  let seen
  globalThis.fetch = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => response } }
  try { return await fn(() => seen) } finally { globalThis.fetch = real }
}
test('openai adapter: parses text and tool calls, drops malformed tool calls', async () => {
  const body = { choices: [{ finish_reason: 'tool_calls', message: { content: 'Here you go', tool_calls: [
    { function: { name: 'create_task', arguments: '{"title":"Pay rent"}' } }, { function: { name: 'create_task', arguments: '{bad json' } }] } }] }
  const cfg = resolveProvider({ AI_PROVIDER: 'openai', AI_API_KEY: 'k' })
  await withFetch(body, async (seen) => {
    const r = await callModel(cfg, { system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: toolDefinitions() })
    assert.equal(r.text, 'Here you go')
    assert.deepEqual(r.toolCalls, [{ name: 'create_task', input: { title: 'Pay rent' } }])
    assert.match(seen().url, /api\.openai\.com\/v1\/chat\/completions$/)
    assert.equal(seen().init.headers.authorization, 'Bearer k')
    assert.equal(JSON.parse(seen().init.body).messages[0].role, 'system')
  })
})
test('anthropic adapter: parses text and tool_use blocks', async () => {
  const body = { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Ok' }, { type: 'tool_use', name: 'create_task', input: { title: 'X' } }] }
  await withFetch(body, async (seen) => {
    const r = await callModel(resolveProvider({ AI_API_KEY: 'k' }), { system: 's', messages: [], tools: [] })
    assert.equal(r.text, 'Ok')
    assert.deepEqual(r.toolCalls, [{ name: 'create_task', input: { title: 'X' } }])
    assert.equal(seen().init.headers['x-api-key'], 'k')
  })
})
test('a failing provider surfaces as ProviderError (the function turns it into a friendly message)', async () => {
  const real = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) })
  try { await assert.rejects(() => callModel(resolveProvider({ AI_API_KEY: 'k' }), { system: 's', messages: [] }), /provider_status_500/) } finally { globalThis.fetch = real }
})
