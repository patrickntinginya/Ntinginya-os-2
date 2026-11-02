import assert from 'node:assert/strict'
import test from 'node:test'
import { CHUNK, classifyStorageError, signUrls } from '../src/lib/signedUrls.js'

const client = (script, calls = []) => ({ storage: { from: (b) => ({ createSignedUrls: async (paths, secs) => { calls.push({ b, paths, secs }); const s = script.shift(); if (s instanceof Error) throw s; return typeof s === 'function' ? s(paths) : s } }) } })
const ok = (paths) => ({ data: paths.map((path) => ({ path, signedUrl: `u:${path}`, error: null })), error: null })
const noSleep = { sleep: async () => {} }

test('errors are classified', () => {
  assert.equal(classifyStorageError(new TypeError('Failed to fetch')), 'network')
  assert.equal(classifyStorageError({ message: 'Network request failed' }), 'network')
  assert.equal(classifyStorageError({ statusCode: '401', message: 'x' }), 'auth')
  assert.equal(classifyStorageError({ message: 'new row violates row-level security policy' }), 'auth')
  assert.equal(classifyStorageError({ message: 'Object not found' }), 'missing')
  assert.equal(classifyStorageError({ status: 503 }), 'server')
  assert.equal(classifyStorageError({ status: 429 }), 'server')
  assert.equal(classifyStorageError(null), 'unknown')
})
test('success: one call, all urls, nothing failed', async () => {
  const calls = []
  const r = await signUrls(client([ok], calls), 'bkt', ['a', 'b', 'a'], { ...noSleep, seconds: 60 })
  assert.deepEqual(r, { urls: { a: 'u:a', b: 'u:b' }, failed: [], reason: null, attempts: 1 })
  assert.deepEqual(calls[0], { b: 'bkt', paths: ['a', 'b'], secs: 60 }, 'deduplicated')
})
test('no paths: no request at all', async () => {
  const calls = []; assert.deepEqual(await signUrls(client([], calls), 'b', []), { urls: {}, failed: [], reason: null, attempts: 0 }); assert.equal(calls.length, 0)
})
test('a transient whole-call error is retried and recovers (returned error AND thrown error)', async () => {
  const delays = []
  const r = await signUrls(client([{ data: null, error: { message: 'Failed to fetch' } }, new TypeError('Failed to fetch'), ok]), 'b', ['a'], { sleep: async (ms) => { delays.push(ms) }, delayMs: 100 })
  assert.deepEqual(r.urls, { a: 'u:a' }); assert.equal(r.attempts, 3); assert.deepEqual(delays, [100, 200], 'backs off')
})
test('a persistent error gives up after the attempts and says why', async () => {
  const calls = []
  const r = await signUrls(client([{ data: null, error: { status: 503 } }, { data: null, error: { status: 503 } }, { data: null, error: { status: 503 } }, ok], calls), 'b', ['a', 'b'], noSleep)
  assert.equal(calls.length, 3); assert.deepEqual(r.urls, {}); assert.equal(r.reason, 'server'); assert.deepEqual(r.failed.map((f) => f.path), ['a', 'b'])
})
test('an auth error is NOT retried (retrying cannot fix an expired session)', async () => {
  const calls = []; const r = await signUrls(client([{ data: null, error: { statusCode: '403', message: 'Unauthorized' } }, ok], calls), 'b', ['a'], noSleep)
  assert.equal(calls.length, 1); assert.equal(r.reason, 'auth'); assert.equal(r.failed.length, 1)
})
test('per-item errors: missing files are permanent, others are retried, good ones are kept', async () => {
  const calls = []
  const first = (paths) => ({ data: [{ path: 'good', signedUrl: 'u:good', error: null }, { path: 'gone', signedUrl: null, error: 'Object not found' }, { path: 'flaky', signedUrl: null, error: 'Service unavailable' }], error: null })
  const r = await signUrls(client([first, ok], calls), 'b', ['good', 'gone', 'flaky'], noSleep)
  assert.deepEqual(calls[1].paths, ['flaky'], 'only the retryable one is asked again')
  assert.deepEqual(r.urls, { good: 'u:good', flaky: 'u:flaky' })
  assert.deepEqual(r.failed, [{ path: 'gone', reason: 'missing' }]); assert.equal(r.reason, 'missing')
})
test('a path the server silently skipped counts as failed, not as success', async () => {
  const r = await signUrls(client([() => ({ data: [{ path: 'a', signedUrl: 'u:a', error: null }], error: null }), () => ({ data: [], error: null }), () => ({ data: [], error: null })]), 'b', ['a', 'b'], noSleep)
  assert.deepEqual(r.urls, { a: 'u:a' }); assert.deepEqual(r.failed.map((f) => f.path), ['b'])
})
test('large lists are split into batches', async () => {
  const calls = []; const paths = Array.from({ length: CHUNK * 2 + 5 }, (_, i) => `p${i}`)
  const r = await signUrls(client([ok, ok, ok], calls), 'b', paths, noSleep)
  assert.deepEqual(calls.map((c) => c.paths.length), [CHUNK, CHUNK, 5]); assert.equal(Object.keys(r.urls).length, paths.length)
})
test('the Safe Mode page uses it and shows the outcome', async () => {
  const fs = await import('node:fs'); const page = fs.readFileSync(new URL('../src/pages/SafeMode.jsx', import.meta.url), 'utf8')
  assert.match(page, /signUrls\(supabase, BUCKET/); assert.ok(!/createSignedUrls/.test(page), 'no unchecked direct call left')
  assert.match(page, /urlIssue/); assert.match(page, /onLoadError=\{load\}/)
})
