// A retry after "uploaded, but the message could not be saved" must not fail with "already exists".
import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatService } from '../src/services/chat.js'
import { isAlreadyUploaded } from '../src/lib/storageUpload.js'

const ME = '11111111-1111-4111-8111-111111111111'; const CV = '22222222-2222-4222-8222-222222222222'
const voice = () => ({ name: 'v.webm', type: 'audio/webm', size: 2000 })

// a minimal client: storage.upload fails with `uploadError`, message insert fails (first) with `insertError`, then works
function client({ uploadErrors = [], insertErrors = [] } = {}) {
  const log = []; const ue = [...uploadErrors]; const ie = [...insertErrors]
  const chain = () => { const t = { ops: [] }; const self = new Proxy(t, { get: (_, k) => {
    if (k === 'single') return () => { const e = ie.shift(); return Promise.resolve(e ? { data: null, error: e } : { data: { id: 'm1', client_id: 'cid-1' }, error: null }) }
    if (k === 'maybeSingle') return () => Promise.resolve({ data: null, error: null })
    if (k === 'then') return (r) => r({ data: [], error: null })
    return (...a) => { if (k === 'insert') log.push({ insert: a[0] }); return self }
  } }); return self }
  return { log, from: chain, rpc: async () => ({ data: null, error: null }),
    storage: { from: () => ({ upload: async (p) => { log.push({ upload: p }); const e = ue.shift(); return e ? { data: null, error: e } : { data: {}, error: null } }, remove: async (ps) => { log.push({ remove: ps }); return { data: [], error: null } } }) } }
}
const dup = () => Object.assign(new Error('The resource already exists'), { statusCode: '409' })

test('isAlreadyUploaded recognises the Storage "already exists" answers and nothing else', () => {
  assert.equal(isAlreadyUploaded(dup()), true)
  assert.equal(isAlreadyUploaded({ status: 409 }), true)
  assert.equal(isAlreadyUploaded(new Error('Duplicate')), true)
  for (const e of [null, new Error('network'), { status: 401 }, { statusCode: '413' }, { status: 500, message: 'boom' }]) assert.equal(isAlreadyUploaded(e), false)
})

test('retrying a voice message whose file already arrived continues to the insert (same path, same client id)', async () => {
  const c = client({ uploadErrors: [null, dup()], insertErrors: [new Error('network down')] })
  const svc = createChatService(c)
  await assert.rejects(svc.send({ conversationId: CV, me: ME, file: voice(), kind: 'voice', durationMs: 3000, clientId: 'cid-1' }))
  const row = await svc.send({ conversationId: CV, me: ME, file: voice(), kind: 'voice', durationMs: 3000, clientId: 'cid-1' }) // the retry
  assert.equal(row.id, 'm1')
  const paths = c.log.filter((l) => l.upload).map((l) => l.upload)
  assert.equal(paths.length, 2); assert.equal(paths[0], paths[1], 'the retry uses the SAME object path')
  assert.equal(c.log.filter((l) => l.insert).length, 2)
})

test('a genuine upload failure is still an error (nothing is inserted)', async () => {
  for (const status of [401, 413, 500]) {
    const c = client({ uploadErrors: [Object.assign(new Error('nope'), { statusCode: String(status) })] })
    await assert.rejects(createChatService(c).send({ conversationId: CV, me: ME, file: voice(), kind: 'voice', durationMs: 3000, clientId: 'cid-9' }))
    assert.ok(!c.log.some((l) => l.insert), `status ${status}: no message`)
  }
})
