import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { handleAiRequest } from '../api/_lib/ai/handler.js'
import { toWebRequest, sendWebResponse } from '../api/_lib/ai/nodeAdapter.js'
import { callModel, resolveProvider } from '../api/_lib/ai/provider.js'
import aiChat from '../api/ai-chat.js'

const URL_ = 'https://app.example/api/ai-chat'
const ENV = { GEMINI_API_KEY: 'test-key-not-real', AI_PROVIDER: 'gemini', VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' }
const call = (method, { headers = {}, body, env = ENV } = {}) => handleAiRequest(new Request(URL_ + (method === 'GET' ? '?status=1' : ''), { method, headers, ...(body !== undefined ? { body } : {}) }), env)

test('GET ?status=1 reports configuration without leaking secrets', async () => {
  const res = await call('GET')
  assert.equal(res.status, 200)
  const text = await res.text()
  assert.equal(JSON.parse(text).configured, true)
  assert.ok(!text.includes('test-key-not-real'))
})

test('GET without status flag is 405; unknown methods are 405', async () => {
  assert.equal((await handleAiRequest(new Request(URL_), ENV)).status, 405)
  assert.equal((await call('PUT', { body: '{}' })).status, 405)
})

test('OPTIONS: Android origin gets 204 + exact CORS headers; foreign origin gets 403', async () => {
  const ok = await call('OPTIONS', { headers: { origin: 'https://localhost' } })
  assert.equal(ok.status, 204)
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://localhost')
  const bad = await call('OPTIONS', { headers: { origin: 'https://evil.example' } })
  assert.equal(bad.status, 403)
  assert.equal(bad.headers.get('access-control-allow-origin'), null)
})

test('POST from a foreign origin is refused before any work is done', async () => {
  const res = await call('POST', { headers: { origin: 'https://evil.example', authorization: 'Bearer abc' }, body: '{}' })
  assert.equal(res.status, 403)
  assert.equal((await res.json()).error, 'origin_not_allowed')
})

test('POST from the website itself (same origin, Origin header present) is not blocked by CORS', async () => {
  const res = await call('POST', { headers: { origin: 'https://app.example' }, body: '{}' })
  assert.equal(res.status, 401, 'reaches the auth check')
})

test('POST without a Bearer token is 401 with a safe message', async () => {
  const res = await call('POST', { body: JSON.stringify({ message: 'hi' }) })
  assert.equal(res.status, 401)
  assert.equal((await res.json()).error, 'unauthorized')
})

test('missing Supabase server configuration is a 500 that reveals nothing', async () => {
  const res = await call('POST', { headers: { authorization: 'Bearer t' }, body: '{}', env: { GEMINI_API_KEY: 'k' } })
  assert.equal(res.status, 500)
  const text = await res.text()
  assert.equal(JSON.parse(text).error, 'server_misconfigured')
  assert.ok(!/supabase|VITE_/i.test(text))
})

test('Android CORS headers are added to error responses too (so the app can read them)', async () => {
  const res = await call('POST', { headers: { origin: 'https://localhost' }, body: '{}' })
  assert.equal(res.status, 401)
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://localhost')
})

// ---- Node adapter (what Vercel actually hands to the function)
const nodeReq = ({ method = 'POST', headers = {}, body, parsed } = {}) => {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(body)])
  Object.assign(stream, { method, url: '/api/ai-chat', headers: { host: 'app.example', 'x-forwarded-proto': 'https', ...headers } })
  if (parsed !== undefined) stream.body = parsed
  return stream
}
const nodeRes = () => {
  const r = { headers: {}, statusCode: 200, ended: null, setHeader(k, v) { this.headers[k] = v }, end(b) { this.ended = b ? Buffer.from(b).toString('utf8') : '' } }
  return r
}

test('adapter reads a raw stream body', async () => {
  const req = await toWebRequest(nodeReq({ body: '{"message":"hello"}', headers: { 'content-type': 'application/json' } }))
  assert.equal(req.url, URL_)
  assert.equal(await req.text(), '{"message":"hello"}')
})

test('adapter uses a body the platform already parsed (empty stream must not lose the message)', async () => {
  const req = await toWebRequest(nodeReq({ parsed: { message: 'hello' }, headers: { 'content-type': 'application/json' } }))
  assert.equal(await req.text(), '{"message":"hello"}')
})

test('adapter rejects oversized bodies and does not forward cookies', async () => {
  await assert.rejects(toWebRequest(nodeReq({ body: 'x'.repeat(70000) })), /too_large/)
  const req = await toWebRequest(nodeReq({ method: 'GET', headers: { cookie: 'secret=1' } }))
  assert.equal(req.headers.get('cookie'), null)
})

test('the default export answers a real Node-style request end to end (401 without token, JSON body, no-store)', async () => {
  const res = nodeRes()
  const saved = { u: process.env.VITE_SUPABASE_URL, k: process.env.VITE_SUPABASE_ANON_KEY }
  process.env.VITE_SUPABASE_URL = 'https://x.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY = 'anon'
  try { await aiChat(nodeReq({ body: '{"message":"hi"}', headers: { 'content-type': 'application/json' } }), res) } finally {
    for (const [n, v] of [['VITE_SUPABASE_URL', saved.u], ['VITE_SUPABASE_ANON_KEY', saved.k]]) v === undefined ? delete process.env[n] : (process.env[n] = v)
  }
  assert.equal(res.statusCode, 401)
  assert.equal(JSON.parse(res.ended).error, 'unauthorized')
})

test('sendWebResponse copies status, headers and body', async () => {
  const res = nodeRes()
  await sendWebResponse(res, new Response('{"a":1}', { status: 202, headers: { 'x-test': '1' } }))
  assert.equal(res.statusCode, 202)
  assert.equal(res.headers['x-test'], '1')
  assert.equal(res.ended, '{"a":1}')
})

// ---- Gemini fallback & failure mapping (fetch is stubbed; no network)
const withFetch = async (impl, fn) => {
  const real = globalThis.fetch
  globalThis.fetch = impl
  try { return await fn() } finally { globalThis.fetch = real }
}
const ok = (text) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }), { status: 200 })

test('Gemini: when the default model is rejected (404) and GEMINI_MODEL is unset, one fallback model is tried', async () => {
  const cfg = resolveProvider({ GEMINI_API_KEY: 'k' })
  const urls = []
  const out = await withFetch(async (u) => { urls.push(String(u)); return urls.length === 1 ? new Response('{}', { status: 404 }) : ok('hello') }, () => callModel(cfg, { system: 's', messages: [{ role: 'user', content: 'x' }] }))
  assert.equal(out.text, 'hello')
  assert.equal(urls.length, 2)
  assert.notEqual(urls[0], urls[1])
})

test('Gemini: an explicit GEMINI_MODEL is never silently replaced', async () => {
  const cfg = resolveProvider({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'my-model' })
  let n = 0
  await assert.rejects(withFetch(async () => { n++; return new Response('{}', { status: 404 }) }, () => callModel(cfg, { system: 's', messages: [{ role: 'user', content: 'x' }] })), (e) => e.kind === 'model')
  assert.equal(n, 1)
})

test('Gemini: the API key travels in a header, never in the URL', async () => {
  const cfg = resolveProvider({ GEMINI_API_KEY: 'secret-k' })
  let seen
  await withFetch(async (u, init) => { seen = { u: String(u), h: init.headers }; return ok('hi') }, () => callModel(cfg, { system: 's', messages: [{ role: 'user', content: 'x' }] }))
  assert.ok(!seen.u.includes('secret-k'))
  assert.equal(seen.h['x-goog-api-key'], 'secret-k')
})
