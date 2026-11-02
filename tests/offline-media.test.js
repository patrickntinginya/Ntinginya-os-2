import assert from 'node:assert/strict'
import test from 'node:test'
import { CLOUD_LIST_LIMIT, createOfflineMedia, downloadability, MAX_BYTES, stateOf } from '../src/lib/offlineMedia.js'

const ME = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const item = (o = {}) => ({ id: 'm1', user_id: ME, title: 'Rain', media_type: 'audio', mime_type: 'audio/mpeg', size_bytes: 10, storage_path: `${ME}/a.mp3`, visibility: 'personal', created_at: '2026-10-01', ...o })

function memStore() {
  const meta = new Map(); const blobs = new Map()
  return { meta, blobs, listMeta: async () => [...meta.values()].map((m) => ({ ...m })), getMeta: async (id) => (meta.has(id) ? { ...meta.get(id) } : null), putMeta: async (m) => { meta.set(m.id, { ...m }) }, deleteMeta: async (id) => { meta.delete(id) },
    putBlob: async (id, b) => { blobs.set(id, b) }, getBlob: async (id) => blobs.get(id) || null, hasBlob: async (id) => blobs.has(id), deleteBlob: async (id) => { blobs.delete(id) }, listBlobIds: async () => [...blobs.keys()] }
}
// A fake network that streams `bytes` in 2 chunks.
function net({ bytes = 10, status = 200, fail = false, gate = null } = {}) {
  const calls = []
  const fetchFn = async (url, { signal } = {}) => {
    calls.push(url)
    if (fail) throw new TypeError('network down')
    if (gate) await gate
    if (signal && signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e }
    const data = new Uint8Array(bytes).fill(7)
    const body = new ReadableStream({ start(c) { c.enqueue(data.slice(0, Math.ceil(bytes / 2))); c.enqueue(data.slice(Math.ceil(bytes / 2))); c.close() } })
    return new Response(status === 200 ? body : null, { status, headers: { 'content-length': String(bytes), 'content-type': 'audio/mpeg' } })
  }
  return { fetchFn, calls }
}
const make = (o = {}) => { const store = o.store || memStore(); const n = o.net || net(); return { store, n, off: createOfflineMedia({ store, getSignedUrl: o.getSignedUrl || (async (p) => `https://x/${p}`), fetchFn: n.fetchFn, estimate: o.estimate || (async () => null), now: () => 1000 }) } }

test('only the person\'s own private files and admin-shared files can be downloaded', () => {
  assert.equal(downloadability(item(), ME).ok, true)
  assert.equal(downloadability(item({ visibility: 'shared', storage_path: `shared/${OTHER}/a.mp3`, user_id: OTHER }), ME).ok, true)
  assert.equal(downloadability(item(), OTHER).code, 'not_allowed', 'somebody else\'s personal file')
  assert.equal(downloadability(item({ visibility: 'personal', storage_path: `shared/x/a.mp3` }), ME).code, 'not_allowed', 'path outside the owner folder')
  assert.equal(downloadability(item({ storage_path: null }), ME).code, 'not_cloud', 'a link or YouTube item has no cloud file')
  assert.equal(downloadability(item({ media_type: 'document' }), ME).code, 'bad_type')
  assert.equal(downloadability(item({ size_bytes: MAX_BYTES + 1 }), ME).code, 'too_big')
  assert.equal(downloadability(null, ME).code, 'not_cloud')
})

test('download stores the bytes, reports progress and records the file only after it is stored', async () => {
  const { off, store } = make(); const seen = []
  const order = []; const putBlob = store.putBlob; const putMeta = store.putMeta
  store.putBlob = async (...a) => { order.push('blob'); return putBlob(...a) }; store.putMeta = async (...a) => { order.push('meta'); return putMeta(...a) }
  const r = await off.download(item(), { userId: ME, onProgress: (p) => seen.push(p.loaded) })
  assert.deepEqual(r, { ok: true, status: 'downloaded' })
  assert.deepEqual(seen, [5, 10]); assert.deepEqual(order, ['blob', 'meta'])
  const meta = await off.get('m1')
  assert.equal(meta.status, 'downloaded'); assert.equal(meta.stale, false); assert.equal(meta.downloaded_at, 1000)
  const p = await off.playable('m1'); assert.equal(p.blob.size, 10)
  assert.deepEqual(await off.usage(), { count: 1, bytes: 10 })
  assert.equal(stateOf(meta, null), 'offline')
})

test('the same file is never downloaded twice: concurrent calls share one request, later calls do nothing', async () => {
  let open; const gate = new Promise((r) => { open = r }); const { off, n } = make({ net: net({ gate }) })
  const a = off.download(item(), { userId: ME }); const b = off.download(item(), { userId: ME })
  await new Promise((r) => setTimeout(r, 5)); open()
  const [ra, rb] = await Promise.all([a, b])
  assert.equal(n.calls.length, 1); assert.equal(ra, rb)
  assert.equal((await off.download(item(), { userId: ME })).status, 'already'); assert.equal(n.calls.length, 1)
})

test('failures are classified, stored for retry, and leave no half file', async () => {
  for (const [opts, code] of [[{ status: 404 }, 'missing'], [{ status: 403 }, 'expired'], [{ status: 500 }, 'http'], [{ fail: true }, 'network'], [{ bytes: 8 }, 'size_mismatch']]) {
    const { off, store } = make({ net: net(opts) })
    const r = await off.download(item(), { userId: ME })
    assert.deepEqual(r, { ok: false, code }, code)
    assert.equal(store.blobs.size, 0, `${code}: no bytes kept`)
    const m = await off.get('m1'); assert.equal(m.status, 'failed'); assert.equal(m.error, code); assert.equal(stateOf(m, null), 'failed')
    assert.equal((await off.usage()).count, 0)
  }
  const { off } = make({ getSignedUrl: async () => { throw new Error('x') } })
  assert.equal((await off.download(item(), { userId: ME })).code, 'url')
})

test('retry after a failure works, and a failed update never destroys the good copy', async () => {
  const store = memStore()
  const bad = make({ store, net: net({ fail: true }) }); assert.equal((await bad.off.download(item(), { userId: ME })).ok, false)
  const good = make({ store }); assert.equal((await good.off.download(item(), { userId: ME })).ok, true)
  const again = make({ store, net: net({ fail: true }) })
  assert.equal((await again.off.download(item(), { userId: ME, force: true })).ok, false)
  assert.equal((await again.off.get('m1')).status, 'downloaded', 'still available offline')
  assert.ok(await again.off.playable('m1'))
})

test('not enough device space is detected before downloading; storage errors clean up', async () => {
  const low = make({ estimate: async () => ({ quota: 1000, usage: 990 }) })
  assert.equal((await low.off.download(item(), { userId: ME })).code, 'no_space'); assert.equal(low.n.calls.length, 0)
  const store = memStore(); store.putMeta = async () => { throw new Error('QuotaExceededError') }
  const full = make({ store }); assert.equal((await full.off.download(item(), { userId: ME })).code, 'storage'); assert.equal(store.blobs.size, 0)
})

test('cancelling stops the download without recording a failure', async () => {
  const ac = new AbortController(); ac.abort()
  const { off, store } = make()
  assert.deepEqual(await off.download(item(), { userId: ME, signal: ac.signal }), { ok: false, code: 'cancelled' })
  assert.equal(store.meta.size, 0); assert.equal(store.blobs.size, 0)
})

test('not-allowed and non-cloud items never reach the network', async () => {
  const { off, n } = make()
  assert.equal((await off.download(item({ storage_path: null }), { userId: ME })).code, 'not_cloud')
  assert.equal((await off.download(item(), { userId: OTHER })).code, 'not_allowed')
  assert.equal(n.calls.length, 0)
})

test('sync: deleted in the cloud is removed; changed file is flagged; renamed is updated; nothing is lost on a partial list', async () => {
  const { off, store } = make()
  for (const id of ['m1', 'm2', 'm3']) await off.download(item({ id, storage_path: `${ME}/${id}.mp3` }), { userId: ME })
  // a truncated/failed fetch must not delete anything
  assert.deepEqual(await off.sync({ cloudRows: [], complete: false }), { removed: 0, stale: 0, renamed: 0 })
  assert.equal(store.meta.size, 3)
  const huge = Array.from({ length: CLOUD_LIST_LIMIT }, (_, i) => item({ id: `x${i}`, storage_path: `${ME}/x${i}` }))
  assert.equal((await off.sync({ cloudRows: huge, complete: true })).removed, 0, 'a list at the page limit may be truncated')
  const rows = [item({ id: 'm1', storage_path: `${ME}/m1.mp3`, title: 'Rain (new name)' }), item({ id: 'm2', storage_path: `${ME}/m2-v2.mp3` })] // m3 deleted
  assert.deepEqual(await off.sync({ cloudRows: rows, complete: true }), { removed: 1, stale: 1, renamed: 1 })
  assert.equal(await off.get('m3'), null); assert.equal(store.blobs.has('m3'), false)
  assert.equal((await off.get('m1')).title, 'Rain (new name)')
  const m2 = await off.get('m2'); assert.equal(m2.stale, true); assert.equal(stateOf(m2, null), 'update'); assert.ok(await off.playable('m2'), 'old copy still plays')
  assert.deepEqual(await off.sync({ cloudRows: rows, complete: true }), { removed: 0, stale: 0, renamed: 0 }, 'idempotent')
  assert.equal((await off.download(item({ id: 'm2', storage_path: `${ME}/m2-v2.mp3` }), { userId: ME })).status, 'downloaded', 'update downloads the new version')
  assert.equal((await off.get('m2')).stale, false)
})

test('reconcile drops orphan bytes and records whose bytes the browser evicted', async () => {
  const { off, store } = make(); await off.download(item(), { userId: ME })
  store.blobs.set('ghost', new Blob(['x'])); store.blobs.delete('m1')
  assert.deepEqual(await off.reconcile(), { orphans: 1, evicted: 1 })
  assert.equal(store.meta.size, 0); assert.equal(store.blobs.size, 0)
  assert.equal(await off.playable('m1'), null, 'never claims to be offline without the bytes')
})

test('delete all downloads empties the device store', async () => {
  const { off, store } = make()
  await off.download(item({ id: 'a', storage_path: `${ME}/a` }), { userId: ME }); await off.download(item({ id: 'b', storage_path: `${ME}/b` }), { userId: ME })
  assert.equal(await off.removeAll(), 2); assert.equal(store.meta.size, 0); assert.equal(store.blobs.size, 0)
  await off.remove('nothing')
})

test('states shown to the person: cloud, downloading, offline, update, failed', () => {
  assert.equal(stateOf(null, null), 'cloud'); assert.equal(stateOf(null, { loaded: 1 }), 'downloading')
  assert.equal(stateOf({ status: 'downloaded' }, null), 'offline'); assert.equal(stateOf({ status: 'downloaded', stale: true }, null), 'update'); assert.equal(stateOf({ status: 'failed' }, null), 'failed')
})
