// Offline reminder repository (Android): local reads, queued changes, sync, retries, duplicates, conflicts, account isolation.
// Uses an in-memory IndexedDB (tests/helpers/fakeIndexedDB.js) and a scripted fake server. No network, no browser.
// These prove the LOGIC. They do not prove behavior in a real Android WebView.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createIdbStorage } from '../src/services/offlineStorage.js'
import {
  applyOps, classifyError, createDbRemote, createReminderAdapter, createReminderRepository, defaultBackoff, mergeFields, pickColumns, withTimeout,
} from '../src/services/reminderSync.js'
import { nextOccurrence } from '../src/utils/date.js'
import { createFakeIndexedDB } from './helpers/fakeIndexedDB.js'

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const netErr = () => Object.assign(new Error('Failed to fetch'), { code: '' })
const serverRow = (over = {}) => ({
  id: '00000000-0000-4000-8000-0000000000aa', user_id: U1, title: 'Pay rent', description: null, remind_date: '2026-10-12', remind_time: '09:00:00',
  repeat_option: 'none', repeat_interval_days: null, priority: 'medium', task_id: null, goal_id: null, is_done: false,
  created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', ...over,
})

/** A scripted fake of the Supabase side. failures.<method> is a queue of errors to throw on the next calls. */
function makeRemote() {
  const r = { server: new Map(), calls: [], failures: { create: [], get: [], update: [], remove: [], list: [] }, gate: null, loseReplyOnce: false }
  const enter = async (name) => {
    r.calls.push(name)
    if (r.gate) await r.gate
    const f = r.failures[name]?.shift()
    if (f) throw f
  }
  r.create = async (row) => {
    await enter('create')
    if (r.server.has(row.id)) throw Object.assign(new Error('duplicate key'), { code: '23505' })
    const saved = { ...serverRow({ id: row.id }), ...row, user_id: r.owner || U1 }
    r.server.set(row.id, saved)
    if (r.loseReplyOnce) {
      r.loseReplyOnce = false
      throw netErr() // the server stored it, but the phone never heard back
    }
    return saved
  }
  r.get = async (id) => {
    await enter('get')
    return r.server.get(id) || null
  }
  r.update = async (id, patch) => {
    await enter('update')
    if (!r.server.has(id)) throw Object.assign(new Error('0 rows'), { code: 'PGRST116' })
    const next = { ...r.server.get(id), ...patch }
    r.server.set(id, next)
    return next
  }
  r.remove = async (id) => {
    await enter('remove')
    r.server.delete(id)
  }
  r.list = async () => {
    await enter('list')
    return [...r.server.values()]
  }
  r.count = (name) => r.calls.filter((c) => c === name).length
  return r
}

// Tests that need to look at the raw queue reach the repo's fake database through this map.
const idbByRepo = new WeakMap()
const setupIdbOf = (repo) => idbByRepo.get(repo)

let n = 0
const nextUuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

function setup({ user = U1, online = true, idb = createFakeIndexedDB(), remote = makeRemote(), clock = { t: 1_000_000 }, ...opts } = {}) {
  const state = { online, user }
  const repo = createReminderRepository({
    storage: createIdbStorage(idb), remote, resolveUser: async () => state.user, isOnline: () => state.online, now: () => clock.t,
    uuid: nextUuid, timeoutMs: 60, maxAttempts: 3, backoff: (a) => 1000 * a, ...opts,
  })
  repo.setUser(user)
  idbByRepo.set(repo, idb)
  return { repo, remote, state, idb, clock }
}
const form = (over = {}) => ({ title: 'Call mum', remind_date: '2026-10-15', remind_time: '08:30', repeat_option: 'none', ...over })

// ------------------------------------------------------------------------------------------------ offline reads and queueing
test('offline: a created reminder is saved on the phone, shown immediately, and not sent', async () => {
  const { repo, remote } = setup({ online: false })
  const created = await repo.create('reminders', form())
  assert.match(created.id, /^00000000-0000-4000-8000-/)
  assert.equal(created._pending, true)
  assert.equal(created.remind_time, '08:30:00', 'time is normalized like the form does')
  assert.equal(remote.calls.length, 0)
  const listed = await repo.list('reminders', { order: [{ column: 'created_at', ascending: false }] })
  assert.deepEqual(listed.map((r) => r.id), [created.id])
  assert.deepEqual(await repo.status(), { pending: 1, failed: 0, conflicts: 0 })
})

test('offline: reads come from the cached server copy, with pending changes laid on top', async () => {
  const { repo, remote, state } = setup()
  remote.server.set(serverRow().id, serverRow())
  await repo.list('reminders') // online read fills the cache
  state.online = false
  await repo.update('reminders', serverRow().id, { title: 'Pay rent today' })
  const [row] = await repo.list('reminders')
  assert.equal(row.title, 'Pay rent today')
  assert.equal(row._pending, true)
  assert.equal(remote.count('update'), 0)
})

test('sync: a queued create reaches the server once, under the client-generated id', async () => {
  const { repo, remote, state } = setup({ online: false })
  const { id } = await repo.create('reminders', form())
  state.online = true
  const result = await repo.sync({ force: true })
  assert.equal(result.synced, 1)
  assert.equal(remote.server.size, 1)
  assert.ok(remote.server.has(id), 'the server row uses the id the phone generated')
  assert.deepEqual(await repo.status(), { pending: 0, failed: 0, conflicts: 0 })
})

test('two offline edits become ONE queued change and ONE server update', async () => {
  const { repo, remote, state } = setup()
  const id = serverRow().id
  remote.server.set(id, serverRow())
  await repo.list('reminders')
  state.online = false
  await repo.update('reminders', id, { title: 'A' })
  await repo.update('reminders', id, { priority: 'high' })
  assert.equal((await repo.status()).pending, 1)
  state.online = true
  await repo.sync({ force: true })
  assert.equal(remote.count('update'), 1)
  assert.equal(remote.server.get(id).title, 'A')
  assert.equal(remote.server.get(id).priority, 'high')
})

test('create then delete while offline never touches the server', async () => {
  const { repo, remote, state } = setup({ online: false })
  const { id } = await repo.create('reminders', form())
  await repo.remove('reminders', id)
  assert.equal((await repo.status()).pending, 0)
  state.online = true
  await repo.sync({ force: true })
  assert.equal(remote.calls.length, 0)
  assert.deepEqual(await repo.readLocal(), [])
})

test('deleting a synced reminder hides it at once and removes it on the server once', async () => {
  const { repo, remote, state } = setup()
  const id = serverRow().id
  remote.server.set(id, serverRow())
  await repo.list('reminders')
  state.online = false
  await repo.remove('reminders', id)
  assert.deepEqual(await repo.readLocal(), [])
  state.online = true
  await repo.sync({ force: true })
  assert.equal(remote.count('remove'), 1)
  assert.equal(remote.server.size, 0)
})

// ------------------------------------------------------------------------------------------------ duplicates and idempotency
test('a create whose reply was lost is retried WITHOUT creating a second reminder', async () => {
  const { repo, remote, state, clock } = setup({ online: false })
  await repo.create('reminders', form())
  state.online = true
  remote.loseReplyOnce = true
  const first = await repo.sync({ force: true })
  assert.equal(first.failed, 1)
  assert.equal(remote.server.size, 1, 'the server did store it')
  clock.t += 5000 // backoff elapsed
  const second = await repo.sync()
  assert.equal(second.synced, 1)
  assert.equal(remote.server.size, 1, 'still exactly one reminder')
  assert.deepEqual(await repo.status(), { pending: 0, failed: 0, conflicts: 0 })
})

test('a create that collides with someone else\'s id is a permanent failure, not an endless retry', async () => {
  const { repo, remote, state } = setup({ online: false })
  const { id } = await repo.create('reminders', form())
  remote.create = async () => {
    remote.calls.push('create')
    throw Object.assign(new Error('duplicate key'), { code: '23505' })
  }
  remote.get = async () => null // row exists but belongs to another user, so row-level security hides it
  state.online = true
  await repo.sync({ force: true })
  const s = await repo.status()
  assert.equal(s.failed, 1)
  assert.equal(remote.count('create'), 1)
  assert.ok(id)
})

test('syncing twice in a row sends nothing the second time', async () => {
  const { repo, remote, state } = setup({ online: false })
  await repo.create('reminders', form())
  state.online = true
  await repo.sync({ force: true })
  await repo.sync({ force: true })
  assert.equal(remote.count('create'), 1)
})

test('only one sync runs at a time (concurrent calls share the same run)', async () => {
  const { repo, remote, state } = setup({ online: false })
  await repo.create('reminders', form())
  state.online = true
  const [a, b] = await Promise.all([repo.sync({ force: true }), repo.sync({ force: true })])
  assert.equal(a, b)
  assert.equal(remote.count('create'), 1)
})

// ------------------------------------------------------------------------------------------------ retries, backoff, timeout
test('transient failures retry with growing backoff and respect the wait', async () => {
  const { repo, remote, state, clock } = setup({ online: false })
  await repo.create('reminders', form())
  state.online = true
  remote.failures.create.push(netErr(), netErr())
  const t0 = clock.t
  await repo.sync({ force: true })
  assert.equal(remote.count('create'), 1)
  const [op1] = await createIdbStorage(setupIdbOf(repo)).listOps(U1)
  assert.equal(op1.attempts, 1)
  assert.equal(op1.next_attempt_at, t0 + 1000)
  await repo.sync() // not due yet: nothing is sent
  assert.equal(remote.count('create'), 1)
  clock.t = t0 + 1000
  await repo.sync()
  assert.equal(remote.count('create'), 2)
  clock.t = t0 + 1000 + 2000
  const done = await repo.sync()
  assert.equal(done.synced, 1)
  assert.equal(remote.server.size, 1)
})

test('retries are bounded: after maxAttempts the change is marked failed and stops retrying', async () => {
  const { repo, remote, state, clock } = setup({ online: false })
  await repo.create('reminders', form())
  state.online = true
  remote.failures.create.push(netErr(), netErr(), netErr(), netErr(), netErr())
  for (let i = 0; i < 6; i++) {
    clock.t += 60_000
    await repo.sync()
  }
  assert.equal(remote.count('create'), 3, 'maxAttempts is 3 in this test')
  assert.deepEqual(await repo.status(), { pending: 0, failed: 1, conflicts: 0 })
})

test('retryFailed gives a failed change fresh attempts and it then succeeds', async () => {
  const { repo, remote, state, clock } = setup({ online: false })
  await repo.create('reminders', form())
  state.online = true
  remote.failures.create.push(netErr(), netErr(), netErr())
  for (let i = 0; i < 4; i++) {
    clock.t += 60_000
    await repo.sync()
  }
  assert.equal((await repo.status()).failed, 1)
  await repo.retryFailed()
  assert.equal(remote.server.size, 1)
  assert.deepEqual(await repo.status(), { pending: 0, failed: 0, conflicts: 0 })
})

test('discardFailed removes failed changes and they never come back', async () => {
  const { repo, remote, state } = setup({ online: false })
  await repo.create('reminders', form())
  state.online = true
  remote.failures.create.push(Object.assign(new Error('check violation'), { code: '23514' }))
  await repo.sync({ force: true })
  assert.equal((await repo.status()).failed, 1)
  await repo.discardFailed()
  assert.deepEqual(await repo.status(), { pending: 0, failed: 0, conflicts: 0 })
  assert.deepEqual(await repo.readLocal(), [])
})

test('permanent errors (validation / row-level security) fail at once with no retry', async () => {
  const { repo, remote, state } = setup({ online: false })
  await repo.create('reminders', form())
  state.online = true
  remote.failures.create.push(Object.assign(new Error('new row violates row-level security policy'), { code: '42501' }))
  await repo.sync({ force: true })
  assert.equal(remote.count('create'), 1)
  assert.equal((await repo.status()).failed, 1)
  const [row] = await repo.readLocal()
  assert.equal(row._failed, true, 'the screen can show "Not saved"')
})

test('an expired session pauses sync WITHOUT using up attempts', async () => {
  const { repo, remote, state } = setup({ online: false })
  await repo.create('reminders', form())
  await repo.create('reminders', form({ title: 'Second' }))
  state.online = true
  remote.failures.create.push(Object.assign(new Error('JWT expired'), { status: 401 }))
  const result = await repo.sync({ force: true })
  assert.equal(result.paused, true)
  assert.equal(remote.count('create'), 1, 'stops at the first auth error instead of hammering the server')
  const ops = await createIdbStorage(setupIdbOf(repo)).listOps(U1)
  assert.deepEqual(ops.map((o) => [o.attempts, o.status]), [[0, 'pending'], [0, 'pending']])
  await repo.sync({ force: true })
  assert.equal(remote.server.size, 2)
})

test('the timeout is real: a request that never answers does not hang sync', async () => {
  const { repo, remote, state } = setup({ online: false, timeoutMs: 40 })
  await repo.create('reminders', form())
  state.online = true
  remote.gate = new Promise(() => {}) // never resolves
  const started = Date.now()
  const result = await repo.sync({ force: true })
  assert.ok(Date.now() - started < 1500, 'returned promptly')
  assert.equal(result.failed, 1)
  const [op] = await createIdbStorage(setupIdbOf(repo)).listOps(U1)
  assert.equal(op.attempts, 1)
  assert.equal(op.status, 'pending', 'a timeout is retryable')
})

test('withTimeout rejects with TimeoutError and clears its timer when the promise wins', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 20), (e) => e.name === 'TimeoutError' && e.code === 'timeout')
  assert.equal(await withTimeout(Promise.resolve(7), 1000), 7)
})

test('error classification and backoff schedule', () => {
  assert.equal(classifyError({ code: 'PGRST116' }), 'gone')
  assert.equal(classifyError({ status: 401 }), 'auth')
  assert.equal(classifyError({ message: 'JWT expired' }), 'auth')
  assert.equal(classifyError({ code: '42501' }), 'permanent')
  assert.equal(classifyError({ code: '23514' }), 'permanent')
  assert.equal(classifyError({ status: 400 }), 'permanent')
  assert.equal(classifyError({ status: 503 }), 'transient')
  assert.equal(classifyError({ status: 429 }), 'transient')
  assert.equal(classifyError(new TypeError('Failed to fetch')), 'transient')
  assert.deepEqual([1, 2, 3, 4].map(defaultBackoff), [30000, 60000, 120000, 240000])
  assert.equal(defaultBackoff(50), 900000, 'capped at 15 minutes')
})

// ------------------------------------------------------------------------------------------------ repeat completion
test('completing a repeating reminder moves the date ONCE, even if the first reply is lost and it is retried', async () => {
  const { repo, remote, state, clock } = setup()
  const id = serverRow().id
  remote.server.set(id, serverRow({ repeat_option: 'daily', remind_date: '2026-10-12' }))
  await repo.list('reminders')
  state.online = false
  // exactly what Reminders.jsx does when the user taps "done for now": compute the next date ONCE, on the device.
  const next = nextOccurrence('2026-10-12', 'daily', null, '2026-10-12')
  assert.equal(next, '2026-10-13')
  await repo.update('reminders', id, { remind_date: next })
  state.online = true
  remote.failures.update.push(netErr()) // first attempt fails after... or before reaching the server
  await repo.sync({ force: true })
  clock.t += 5000
  await repo.sync()
  clock.t += 5000
  await repo.sync()
  assert.equal(remote.server.get(id).remind_date, '2026-10-13', 'advanced exactly one day, never two')
  assert.equal(remote.server.get(id).is_done, false, 'a repeating reminder is not marked done')
})

test('completing a one-off reminder sets is_done and undoing it clears it', async () => {
  const { repo, remote } = setup()
  const id = serverRow().id
  remote.server.set(id, serverRow())
  await repo.list('reminders')
  await repo.update('reminders', id, { is_done: true })
  await repo.sync({ force: true })
  assert.equal(remote.server.get(id).is_done, true)
  await repo.update('reminders', id, { is_done: false })
  await repo.sync({ force: true })
  assert.equal(remote.server.get(id).is_done, false)
})

// ------------------------------------------------------------------------------------------------ conflicts
test('conflict: a field changed on the server after the local edit began is NOT overwritten', async () => {
  const { repo, remote, state } = setup()
  const id = serverRow().id
  remote.server.set(id, serverRow({ title: 'Pay rent' }))
  await repo.list('reminders')
  state.online = false
  await repo.update('reminders', id, { title: 'Pay rent (phone)', priority: 'high' })
  remote.server.set(id, { ...remote.server.get(id), title: 'Pay rent (web)' }) // someone edited it on the website meanwhile
  state.online = true
  await repo.sync({ force: true })
  const row = remote.server.get(id)
  assert.equal(row.title, 'Pay rent (web)', 'newer server value kept')
  assert.equal(row.priority, 'high', 'the field the server did not touch is applied')
  assert.equal((await repo.status()).conflicts, 1)
  repo.clearConflicts()
  assert.equal((await repo.status()).conflicts, 0)
})

test('conflict: editing a reminder that was deleted elsewhere drops the edit and is reported', async () => {
  const { repo, remote, state } = setup()
  const id = serverRow().id
  remote.server.set(id, serverRow())
  await repo.list('reminders')
  state.online = false
  await repo.update('reminders', id, { title: 'Edited' })
  remote.server.delete(id)
  state.online = true
  await repo.sync({ force: true })
  assert.equal(remote.server.size, 0, 'the deleted reminder is not resurrected')
  assert.deepEqual(await repo.readLocal(), [])
  assert.equal((await repo.status()).conflicts, 1)
})

test('mergeFields: same value is a no-op, untouched fields apply, changed-on-server fields are kept', () => {
  const base = { title: 'a', priority: 'low', remind_time: '09:00:00' }
  const server = { title: 'b', priority: 'low', remind_time: '09:00:00' }
  assert.deepEqual(mergeFields(base, { title: 'c', priority: 'high' }, server), { apply: { priority: 'high' }, conflicts: ['title'] })
  assert.deepEqual(mergeFields(base, { remind_time: '09:00' }, server), { apply: {}, conflicts: [] })
  assert.deepEqual(mergeFields(null, { title: 'c' }, server), { apply: { title: 'c' }, conflicts: [] })
})

// ------------------------------------------------------------------------------------------------ edge: edit while the create is on the wire
test('edit while the first create is still in flight: if that create fails, the edit is NOT lost and no duplicate appears', async () => {
  const { repo, remote, state, clock } = setup({ online: false, timeoutMs: 1000 })
  const { id } = await repo.create('reminders', form({ title: 'Original' }))
  state.online = true
  let release
  remote.gate = new Promise((r) => (release = r))
  remote.failures.create.push(netErr())
  const running = repo.sync({ force: true }) // the create is now "on the wire"
  await new Promise((r) => setTimeout(r, 20))
  await repo.update('reminders', id, { title: 'Edited meanwhile' })
  remote.gate = null
  release()
  await running // the in-flight create failed
  assert.equal(remote.server.size, 0)
  clock.t += 10_000
  const retry = await repo.sync({ force: true })
  assert.equal(retry.synced, 1)
  assert.equal(remote.server.size, 1)
  assert.equal(remote.server.get(id).title, 'Edited meanwhile', 'the edit survived')
  assert.equal((await repo.readLocal()).length, 1)
})

test('edit while the first create is in flight and that create SUCCEEDS: the edit is applied on top', async () => {
  const { repo, remote, state } = setup({ online: false, timeoutMs: 1000 })
  const { id } = await repo.create('reminders', form({ title: 'Original' }))
  state.online = true
  let release
  remote.gate = new Promise((r) => (release = r))
  const running = repo.sync({ force: true })
  await new Promise((r) => setTimeout(r, 20))
  await repo.update('reminders', id, { title: 'Edited meanwhile' })
  remote.gate = null
  release()
  await running
  await repo.sync({ force: true })
  assert.equal(remote.server.size, 1)
  assert.equal(remote.server.get(id).title, 'Edited meanwhile')
  assert.equal(remote.count('create'), 1)
})

// ------------------------------------------------------------------------------------------------ persistence and account isolation
test('queued changes survive an app restart (same on-device database, new repository)', async () => {
  const idb = createFakeIndexedDB()
  const first = setup({ online: false, idb })
  const { id } = await first.repo.create('reminders', form())
  const second = setup({ online: true, idb }) // "restart"
  const view = await second.repo.readLocal()
  assert.deepEqual(view.map((r) => r.id), [id])
  await second.repo.sync({ force: true })
  assert.ok(second.remote.server.has(id))
})

test('account isolation: user B never sees user A\'s cached reminders or queued changes', async () => {
  const idb = createFakeIndexedDB()
  const a = setup({ user: U1, online: false, idb })
  await a.repo.create('reminders', form({ title: 'A secret' }))
  const b = setup({ user: U2, online: false, idb })
  assert.deepEqual(await b.repo.readLocal(), [])
  assert.deepEqual(await b.repo.list('reminders'), [])
  assert.deepEqual(await b.repo.status(), { pending: 0, failed: 0, conflicts: 0 })
  await b.repo.create('reminders', form({ title: 'B note' }))
  assert.deepEqual((await a.repo.readLocal()).map((r) => r.title), ['A secret'])
  assert.deepEqual((await b.repo.readLocal()).map((r) => r.title), ['B note'])
})

test('account isolation: the same reminder id under two users stays separate', async () => {
  const storage = createIdbStorage(createFakeIndexedDB())
  await storage.putRow(U1, serverRow({ title: 'user 1 copy' }))
  await storage.putRow(U2, serverRow({ title: 'user 2 copy' }))
  assert.equal((await storage.getRow(U1, serverRow().id)).title, 'user 1 copy')
  assert.equal((await storage.getRow(U2, serverRow().id)).title, 'user 2 copy')
  await storage.clearUser(U1)
  assert.equal(await storage.getRow(U1, serverRow().id), null)
  assert.equal((await storage.getRow(U2, serverRow().id)).title, 'user 2 copy', 'clearing one user leaves the other untouched')
})

test('account switch: A\'s queued change is never sent while B is signed in', async () => {
  const idb = createFakeIndexedDB()
  const remote = makeRemote()
  const a = setup({ user: U1, online: false, idb, remote })
  await a.repo.create('reminders', form({ title: 'A only' }))
  const b = setup({ user: U2, online: true, idb, remote })
  remote.owner = U2
  await b.repo.sync({ force: true })
  assert.equal(remote.server.size, 0, 'nothing of A went out under B')
  // when A signs in again, A's change is still there and goes out under A
  const a2 = setup({ user: U1, online: true, idb, remote })
  remote.owner = U1
  await a2.repo.sync({ force: true })
  assert.equal(remote.server.size, 1)
})

test('sign-out keeps unsynced changes, account deletion purges them, neither touches another user', async () => {
  const idb = createFakeIndexedDB()
  const a = setup({ user: U1, online: false, idb })
  await a.repo.create('reminders', form({ title: 'A unsent' }))
  const b = setup({ user: U2, online: false, idb })
  await b.repo.create('reminders', form({ title: 'B unsent' }))
  await a.repo.leaveUser(U1) // sign-out of A
  const storage = createIdbStorage(idb)
  assert.equal((await storage.listOps(U1)).length, 1, 'unsynced work is kept')
  assert.equal((await storage.getSnapshot(U1)).length, 0, 'cached copy is dropped')
  await a.repo.purgeUser(U1) // account deletion
  assert.equal((await storage.listOps(U1)).length, 0)
  assert.equal((await storage.listOps(U2)).length, 1, 'B is untouched')
})

test('storage refuses to work without a signed-in user', async () => {
  const storage = createIdbStorage(createFakeIndexedDB())
  await assert.rejects(storage.getSnapshot(null), /signed-in user/)
  await assert.rejects(storage.putOp('', { reminder_id: 'x' }), /signed-in user/)
})

// ------------------------------------------------------------------------------------------------ storage transactions
test('a failed write rolls back and is reported (nothing half-saved)', async () => {
  const idb = createFakeIndexedDB()
  const storage = createIdbStorage(idb)
  await storage.replaceSnapshot(U1, [serverRow({ id: '00000000-0000-4000-8000-000000000001' }), serverRow({ id: '00000000-0000-4000-8000-000000000002' })])
  let writes = 0
  idb.failWhen = (store, op) => op === 'write' && store === 'rows' && ++writes === 3 // 2 deletes succeed, then the insert of the new row fails: the whole replacement must roll back
  await assert.rejects(storage.replaceSnapshot(U1, [serverRow({ id: '00000000-0000-4000-8000-000000000003' })]))
  idb.failWhen = null
  assert.deepEqual((await storage.getSnapshot(U1)).map((r) => r.id).sort(), ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'], 'old snapshot intact')
})

test('a queued change is only reported saved after the transaction commits', async () => {
  const idb = createFakeIndexedDB()
  const { repo } = setup({ online: false, idb })
  idb.failWhen = (store, op) => store === 'ops' && op === 'write'
  await assert.rejects(repo.create('reminders', form()))
  idb.failWhen = null
  assert.deepEqual(await repo.readLocal(), [], 'a failed save leaves nothing behind')
})

test('old v1 object stores are removed on upgrade', async () => {
  const idb = createFakeIndexedDB()
  await new Promise((resolve) => {
    const req = idb.open('life-os-offline', 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('reminders', { keyPath: 'id' })
      req.result.createObjectStore('mutations', { keyPath: 'id' })
    }
    req.onsuccess = resolve
  })
  const storage = createIdbStorage(idb)
  await storage.putRow(U1, serverRow())
  assert.deepEqual(Object.keys(idb.dump('life-os-offline')).sort(), ['meta', 'ops', 'rows'])
})

// ------------------------------------------------------------------------------------------------ pure helpers and wiring
test('pickColumns keeps only real reminder columns and normalizes the way the form does', () => {
  assert.deepEqual(pickColumns({ title: ' Hi ', remind_time: '7:05', description: '', task_id: '', repeat_interval_days: '3', user_id: 'x', id: 'y', evil: 1 }),
    { title: 'Hi', remind_time: '07:05:00', description: null, task_id: null, repeat_interval_days: 3 })
})

test('applyOps overlays creates, updates and deletes on the cached rows', () => {
  const rows = [serverRow({ id: 'a', title: 'A' }), serverRow({ id: 'b', title: 'B' })]
  const ops = [
    { type: 'update', reminder_id: 'a', patch: { title: 'A2' }, status: 'pending', queued_at: 1 },
    { type: 'delete', reminder_id: 'b', status: 'pending', queued_at: 2 },
    { type: 'create', reminder_id: 'c', row: { id: 'c', title: 'C', remind_date: '2026-10-20' }, status: 'failed', queued_at: 3 },
  ]
  const out = applyOps(rows, ops, U1)
  assert.deepEqual(out.map((r) => r.title).sort(), ['A2', 'C'])
  assert.equal(out.find((r) => r.id === 'c')._failed, true)
  assert.equal(out.find((r) => r.id === 'c').is_done, false, 'database defaults are applied to unsynced creates')
})

test('createDbRemote builds the single-row lookup the way db.list expects', async () => {
  const seen = []
  const remote = createDbRemote({ list: async (...a) => (seen.push(a), [{ id: 'z' }]) })
  assert.deepEqual(await remote.get('z'), { id: 'z' })
  assert.deepEqual(seen[0], ['reminders', { order: [], limit: 1, filters: [{ op: 'eq', column: 'id', value: 'z' }] }])
})

test('the adapter exposes the same methods the generic resource hook calls', () => {
  const adapter = createReminderAdapter(setup().repo)
  for (const m of ['list', 'create', 'update', 'remove', 'subscribe']) assert.equal(typeof adapter[m], 'function')
})

test('listeners are told about local changes and finished syncs, and a failing listener cannot break storage', async () => {
  const { repo } = setup({ online: false })
  const events = []
  repo.subscribe((e) => events.push(e.type))
  repo.subscribe(() => {
    throw new Error('bad listener')
  })
  await repo.create('reminders', form())
  assert.ok(events.includes('changed'))
})
