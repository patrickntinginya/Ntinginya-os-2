import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatService, CHAT_BUCKET } from '../src/services/chat.js'

const ME = '11111111-1111-4111-8111-111111111111'; const CV = '22222222-2222-4222-8222-222222222222'
// A small fake of the supabase-js surface the service uses; records every call.
function fake({ insertResult = null, existing = null, uploadError = null, rpcResult = null } = {}) {
  const log = []
  const chain = (table) => { const q = { table, ops: [] }; const self = new Proxy(q, { get: (t, k) => {
    if (k === 'then') return (res) => res(t.result ?? { data: [], error: null })
    if (k === 'single') return () => Promise.resolve(t.insert ? insertResult : { data: existing, error: null })
    if (k === 'maybeSingle') return () => Promise.resolve({ data: existing, error: null })
    return (...a) => { t.ops.push([k, ...a]); if (k === 'insert') { t.insert = a[0]; log.push({ insert: a[0] }) } return self }
  } }); log.push({ query: q }); return self }
  return { log,
    from: (t) => chain(t),
    rpc: async (name, args) => { log.push({ rpc: name, args }); return rpcResult || { data: null, error: null } },
    storage: { from: (b) => ({ upload: async (p, f, o) => { log.push({ upload: [b, p, o] }); return uploadError ? { data: null, error: uploadError } : { data: {}, error: null } }, remove: async (ps) => { log.push({ remove: [b, ps] }); return { data: [], error: null } } }) } }
}

test('send text: one insert carrying the client id (idempotency key), trimmed body, no upload', async () => {
  const c = fake({ insertResult: { data: { id: 'm1' }, error: null } }); const svc = createChatService(c)
  const r = await svc.send({ conversationId: CV, me: ME, body: '  hello  ', clientId: 'cid-1' })
  assert.equal(r.id, 'm1'); const ins = c.log.find((l) => l.insert).insert
  assert.deepEqual([ins.body, ins.client_id, ins.kind, ins.sender_id, ins.conversation_id], ['hello', 'cid-1', 'text', ME, CV]); assert.ok(!c.log.some((l) => l.upload))
})
test('send with a file: uploads to <me>/<conversation>/..., then inserts the media row; the path matches the policy shape', async () => {
  const c = fake({ insertResult: { data: { id: 'm2' }, error: null } }); const svc = createChatService(c)
  await svc.send({ conversationId: CV, me: ME, body: '', file: { name: 'pic.png', type: 'image/png', size: 5 }, clientId: 'cid-2' })
  const [bucket, path, opts] = c.log.find((l) => l.upload).upload
  assert.equal(bucket, CHAT_BUCKET); assert.ok(path.startsWith(`${ME}/${CV}/`)); assert.equal(opts.upsert, false)
  const ins = c.log.find((l) => l.insert).insert; assert.equal(ins.kind, 'image'); assert.equal(ins.media_path, path); assert.equal(ins.body, null)
})
test('a rejected insert removes the uploaded file (no orphan files)', async () => {
  const c = fake({ insertResult: { data: null, error: { code: '42501', message: 'row-level security' } } }); const svc = createChatService(c)
  await assert.rejects(svc.send({ conversationId: CV, me: ME, file: { name: 'a.pdf', type: 'application/pdf', size: 5 }, clientId: 'c3' }))
  const up = c.log.find((l) => l.upload).upload[1]; assert.deepEqual(c.log.find((l) => l.remove).remove, [CHAT_BUCKET, [up]])
})
test('a failed upload never inserts a message', async () => {
  const c = fake({ uploadError: { message: 'nope' } }); const svc = createChatService(c)
  await assert.rejects(svc.send({ conversationId: CV, me: ME, file: { name: 'a.png', type: 'image/png', size: 5 }, clientId: 'c4' }))
  assert.ok(!c.log.some((l) => l.insert))
})
test('a retry of a message that already arrived returns the stored one and keeps its file', async () => {
  const stored = { id: 'old', client_id: 'c5' }
  const c = fake({ insertResult: { data: null, error: { code: '23505', message: 'duplicate key' } }, existing: stored }); const svc = createChatService(c)
  const r = await svc.send({ conversationId: CV, me: ME, body: 'x', clientId: 'c5' }); assert.equal(r, stored); assert.ok(!c.log.some((l) => l.remove))
})
test('disallowed file types are refused before any network call', async () => {
  const c = fake(); await assert.rejects(createChatService(c).send({ conversationId: CV, me: ME, file: { name: 'x.exe', type: 'application/x-msdownload', size: 5 } }), /not allowed/)
  assert.equal(c.log.length, 0)
})
test('delete removes the file FIRST and the message second (since migration 011 only a live message makes the file removable); no file means no storage call', async () => {
  const a = fake({ existing: { media_path: `${ME}/${CV}/f.png` } }); await createChatService(a).remove('m1')
  const order = a.log.filter((l) => l.remove || l.rpc).map((l) => (l.remove ? 'file' : l.rpc))
  assert.deepEqual(order, ['file', 'chat_delete'])
  assert.deepEqual(a.log.find((l) => l.remove).remove, [CHAT_BUCKET, [`${ME}/${CV}/f.png`]])
  const b = fake({ existing: { media_path: null } }); await createChatService(b).remove('m2'); assert.ok(!b.log.some((l) => l.remove)); assert.ok(b.log.some((l) => l.rpc === 'chat_delete'))
})
test('delete still deletes the message when the file cannot be removed (the cleanup job handles the orphan)', async () => {
  const c = fake({ existing: { media_path: `${ME}/${CV}/f.png` } })
  c.storage = { from: () => ({ remove: async () => { throw new Error('not allowed') } }) }
  await createChatService(c).remove('m3'); assert.ok(c.log.some((l) => l.rpc === 'chat_delete'))
})
test('rpc errors are thrown, and rpc argument names match the SQL functions', async () => {
  const svc = createChatService(fake({ rpcResult: { data: null, error: { message: 'blocked' } } })); await assert.rejects(svc.startDirect('x'), (e) => e.message === 'blocked')
  const c = fake(); const s = createChatService(c)
  await s.startDirect('u'); await s.createGroup(' Team ', ['a', 'a', 'b']); await s.mark(CV, false); await s.edit('m', ' hi '); await s.report('m', 'spam')
  const args = Object.fromEntries(c.log.filter((l) => l.rpc).map((l) => [l.rpc, l.args]))
  assert.deepEqual(args.chat_start_direct, { p_other: 'u' }); assert.deepEqual(args.chat_create_group, { p_title: 'Team', p_members: ['a', 'b'] })
  assert.deepEqual(args.chat_mark, { p_conv: CV, p_read: false }); assert.deepEqual(args.chat_edit, { p_message: 'm', p_body: 'hi' }); assert.deepEqual(args.chat_report, { p_message: 'm', p_reason: 'spam', p_details: null })
})
test('history is paged newest-first and returned oldest-first; search patterns are sanitised', async () => {
  const c = fake(); const svc = createChatService(c); await svc.messages(CV, { before: '2026-10-31T10:00:00Z' })
  const ops = c.log.find((l) => l.query && l.query.table === 'chat_messages').query.ops.map((o) => o[0] + ':' + o.slice(1).join(','))
  assert.ok(ops.some((o) => o.startsWith('order:created_at')), 'ordered'); assert.ok(ops.some((o) => o === 'limit:30')); assert.ok(ops.some((o) => o.startsWith('lt:created_at')))
  assert.deepEqual(await svc.search('   '), [], 'empty search makes no query')
  await svc.search('a,b).or(x', CV); const q = c.log.filter((l) => l.query && l.query.table === 'chat_messages').pop().query.ops.find((o) => o[0] === 'ilike')
  assert.ok(!/[,()]/.test(q[2]), q[2])
})

// ---------------------------------------------------------------- voice messages
const voiceFile = (o = {}) => ({ name: 'voice-1.webm', type: 'audio/webm;codecs=opus', size: 40000, ...o })
test('voice: the codec parameter is removed from the content type (the bucket compares the plain type) and the duration is stored', async () => {
  const c = fake({ insertResult: { data: { id: 'v1' }, error: null } })
  await createChatService(c).send({ conversationId: CV, me: ME, body: '', file: voiceFile(), kind: 'voice', durationMs: 7234.6, clientId: 'cv1' })
  assert.equal(c.log.find((l) => l.upload).upload[2].contentType, 'audio/webm')
  const ins = c.log.find((l) => l.insert).insert; assert.deepEqual([ins.kind, ins.media_mime, ins.duration_ms, ins.media_size], ['voice', 'audio/webm', 7235, 40000])
})
test('voice: a recording that breaks the limits never reaches the network', async () => {
  for (const [file, ms] of [[voiceFile({ size: 6000000 }), 5000], [voiceFile(), 100], [voiceFile({ type: 'image/png' }), 5000], [voiceFile(), 400000]]) {
    const c = fake({}); await assert.rejects(createChatService(c).send({ conversationId: CV, me: ME, file, kind: 'voice', durationMs: ms }))
    assert.ok(!c.log.some((l) => l.upload || l.insert))
  }
})
test('upload progress: real progress through the REST uploader with the session token; supabase-js is not used', async () => {
  const c = fake({ insertResult: { data: { id: 'v2' }, error: null } }); c.supabaseUrl = 'https://x.supabase.co'; c.supabaseKey = 'anon'; c.auth = { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) }
  const calls = []; const seen = []
  await createChatService(c).send({ conversationId: CV, me: ME, file: voiceFile(), kind: 'voice', durationMs: 3000, clientId: 'cv2', onProgress: (p) => seen.push(p.percent),
    uploadFn: async (a) => { calls.push(a); a.onProgress({ percent: 50 }); a.onProgress({ percent: 100 }) } })
  assert.equal(calls.length, 1); assert.equal(calls[0].headers.Authorization, 'Bearer tok'); assert.equal(calls[0].contentType, 'audio/webm')
  assert.ok(calls[0].url.startsWith(`https://x.supabase.co/storage/v1/object/${CHAT_BUCKET}/${ME}/${CV}/`)); assert.deepEqual(seen, [50, 100]); assert.ok(!c.log.some((l) => l.upload))
})
test('upload progress: a style rejection (400/415) falls back to supabase-js; real failures do not', async () => {
  const mk = () => { const c = fake({ insertResult: { data: { id: 'v3' }, error: null } }); c.supabaseUrl = 'https://x.supabase.co'; c.supabaseKey = 'anon'; c.auth = { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) }; return c }
  const a = mk(); await createChatService(a).send({ conversationId: CV, me: ME, file: voiceFile(), kind: 'voice', durationMs: 3000, onProgress: () => {}, uploadFn: async () => { const e = new Error('bad'); e.status = 415; throw e } })
  assert.ok(a.log.some((l) => l.upload), 'fallback used')
  for (const status of [0, 401, 413, 500]) {
    const b = mk(); await assert.rejects(createChatService(b).send({ conversationId: CV, me: ME, file: voiceFile(), kind: 'voice', durationMs: 3000, onProgress: () => {}, uploadFn: async () => { const e = new Error('x'); e.status = status; throw e } }))
    assert.ok(!b.log.some((l) => l.upload || l.insert), `status ${status}: no fallback, no message`)
  }
})
