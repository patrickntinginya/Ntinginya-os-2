/**
 * Offline reminders for the Android app: local cache + queued changes + synchronization with Supabase.
 * Rewritten in Phase 2 (the first version was never connected and had retry, timeout and repeat-completion bugs).
 * Used only by the Android shell (src/native/*). The web app keeps talking to Supabase directly through services/db.js.
 *
 * Design rules
 *  - ONE pending change per reminder (create | update | delete). A second edit is merged into it, so order never matters
 *    and a retry can never apply the same change twice.
 *  - Creates carry a client-generated UUID that becomes the row id. If a create actually reached the server but the reply
 *    was lost, the retry hits a duplicate-key error, finds the row, and counts as success. No duplicate reminders.
 *  - Updates are merged FIELD BY FIELD against the server's current row. A field the server changed after the local edit
 *    started is NOT overwritten (server wins, the conflict is counted); fields the server did not touch are applied.
 *  - Completing a repeating reminder is an ordinary update of remind_date computed ONCE on the device when the user taps,
 *    exactly as the existing screen does. It is never recomputed at sync time, so it cannot advance twice.
 *  - Every network call has a real timeout. Failures are classified: transient ones retry with exponential backoff up to
 *    maxAttempts; permanent ones (validation/RLS) stop at once and are shown to the user; auth/expired-session pauses sync
 *    without using up attempts.
 *  - Everything is stored under the signed-in user's id (see offlineStorage.js).
 */
import { sortRows } from '../lib/sortRows.js'
import { uuidv4 } from '../lib/uuid.js'

export const REMINDER_COLUMNS = ['title', 'description', 'remind_date', 'remind_time', 'repeat_option', 'repeat_interval_days', 'priority', 'task_id', 'goal_id', 'is_done']
const NULLABLE = new Set(['description', 'remind_time', 'repeat_interval_days', 'task_id', 'goal_id'])
const DB_DEFAULTS = { is_done: false, repeat_option: 'none', priority: 'medium' }

export const defaultBackoff = (attempts) => Math.min(30000 * 2 ** Math.max(0, attempts - 1), 900000)

const padTime = (v) => (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v) ? `${v.padStart(5, '0')}:00` : v)

/** Keeps only real reminder columns and normalizes values the way the form does ('' -> null, HH:MM -> HH:MM:SS). */
export function pickColumns(values = {}) {
  const out = {}
  for (const key of REMINDER_COLUMNS) {
    if (!(key in values)) continue
    let v = values[key]
    if (typeof v === 'string') v = v.trim()
    if (v === '' || v === undefined) v = NULLABLE.has(key) ? null : v
    if (key === 'remind_time') v = padTime(v)
    if (key === 'repeat_interval_days' && v !== null) v = Number(v)
    out[key] = v
  }
  return out
}

const same = (a, b) => (a ?? null) === (b ?? null)
const norm = (key, v) => (key === 'remind_time' ? padTime(v) ?? null : v ?? null)

/** Which of my local changes can be applied to the server's current row without overwriting newer server data. */
export function mergeFields(base, patch, server) {
  const apply = {}
  const conflicts = []
  for (const key of Object.keys(patch)) {
    const mine = norm(key, patch[key])
    const theirs = norm(key, server[key])
    if (same(mine, theirs)) continue // already there (for example an earlier attempt landed)
    if (base && key in base && !same(norm(key, base[key]), theirs)) {
      conflicts.push(key) // the server changed this field after my edit began: keep the server value
      continue
    }
    apply[key] = patch[key]
  }
  return { apply, conflicts }
}

/** 'gone' | 'auth' | 'permanent' | 'transient' */
export function classifyError(e) {
  const code = String(e?.code ?? '')
  const status = Number(e?.status ?? e?.statusCode ?? 0)
  const message = String(e?.message ?? '')
  if (code === 'PGRST116') return 'gone'
  if (status === 401 || code === 'PGRST301' || /jwt|token.*expired/i.test(message)) return 'auth'
  if (code === '42501' || code === 'x_duplicate_foreign') return 'permanent'
  if (/^(22|23|42)/.test(code)) return 'permanent'
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'transient'
  if (status >= 400 && status < 500) return 'permanent'
  return 'transient' // network down, timeout, unknown: safe to retry because every operation is idempotent
}

export function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('The request timed out'), { name: 'TimeoutError', code: 'timeout' })), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** What the screen shows: cached server rows with the pending local changes laid on top. */
export function applyOps(rows, ops, userId) {
  const byId = new Map(rows.map((r) => [r.id, { ...r }]))
  for (const op of ops) {
    const flags = { _pending: true, _failed: op.status === 'failed' }
    if (op.type === 'create') {
      const iso = new Date(op.queued_at).toISOString()
      byId.set(op.reminder_id, { ...DB_DEFAULTS, ...op.row, user_id: userId, created_at: iso, updated_at: iso, ...flags })
    } else if (op.type === 'update') {
      const cur = byId.get(op.reminder_id)
      if (cur) byId.set(op.reminder_id, { ...cur, ...op.patch, ...flags })
    } else if (op.type === 'delete') {
      byId.delete(op.reminder_id)
    }
  }
  return [...byId.values()]
}

export const createDbRemote = (db) => ({
  list: (order) => db.list('reminders', { order }),
  get: async (id) => (await db.list('reminders', { order: [], limit: 1, filters: [{ op: 'eq', column: 'id', value: id }] }))[0] || null,
  create: (row) => db.create('reminders', row),
  update: (id, patch) => db.update('reminders', id, patch),
  remove: (id) => db.remove('reminders', id),
})

export function createReminderRepository({
  storage, remote, resolveUser, isOnline = () => true, now = Date.now, uuid = uuidv4, timeoutMs = 15000, maxAttempts = 6, backoff = defaultBackoff,
}) {
  let userId = null
  let conflicts = 0
  let syncRun = null
  let lock = Promise.resolve()
  const inflight = new Set()
  const listeners = new Set()

  const emit = (event) => listeners.forEach((l) => { try { l(event) } catch { /* a listener must never break storage */ } })
  const withLock = (fn) => {
    const next = lock.then(fn, fn)
    lock = next.catch(() => {})
    return next
  }
  const requireUser = async () => {
    if (!userId && resolveUser) userId = (await resolveUser()) || null
    if (!userId) throw new Error('Please sign in again.')
    return userId
  }
  const fresh = (extra) => ({ attempts: 0, next_attempt_at: 0, status: 'pending', last_error: null, ...extra })
  const kick = () => { if (isOnline()) sync().catch(() => {}) }

  async function localView(uid, order) {
    const [rows, ops] = await Promise.all([storage.getSnapshot(uid), storage.listOps(uid)])
    const view = applyOps(rows, ops, uid)
    return order ? sortRows(view, order) : view
  }

  // ---------------------------------------------------------------- reads
  async function refresh() {
    const uid = await requireUser()
    if (!isOnline()) return false
    try {
      const rows = await withTimeout(remote.list([{ column: 'created_at', ascending: false }]), timeoutMs)
      if (uid !== userId) return false
      await storage.replaceSnapshot(uid, rows)
      return true
    } catch {
      return false
    }
  }

  async function list(_table, { order } = {}) {
    const uid = await requireUser()
    await refresh()
    return localView(uid, order)
  }

  const readLocal = async () => localView(await requireUser())

  // ---------------------------------------------------------------- writes (each waits for the local commit, then syncs in the background)
  async function create(_table, values) {
    const uid = await requireUser()
    const cols = pickColumns(values)
    if (!cols.title || !cols.remind_date) throw new Error('A reminder needs a title and a date.')
    const id = uuid()
    const row = { id, ...DB_DEFAULTS, ...cols }
    await withLock(() => storage.putOp(uid, { reminder_id: id, type: 'create', row, queued_at: now(), rev: 1, ...fresh() }))
    emit({ type: 'changed' })
    kick()
    return (await localView(uid)).find((r) => r.id === id)
  }

  async function update(_table, id, values) {
    const uid = await requireUser()
    const patch = pickColumns(values)
    if (!Object.keys(patch).length) return (await localView(uid)).find((r) => r.id === id)
    await withLock(async () => {
      const existing = await storage.getOp(uid, id)
      if (!existing) {
        const base = await storage.getRow(uid, id)
        if (!base) throw new Error('That reminder is not available on this phone yet.')
        return storage.putOp(uid, { reminder_id: id, type: 'update', patch, base, queued_at: now(), rev: 1, ...fresh() })
      }
      if (existing.type === 'delete') throw new Error('That reminder was deleted.')
      if (existing.type === 'create') {
        if (inflight.has(`${uid}:${id}`)) {
          // The create is already on its way to the server: follow it with an update, re-based when the create finishes.
          // `create_row` is a fallback: if that create turns out NOT to have reached the server, the follow-up re-creates the row
          // (with the edits) instead of finding nothing and silently dropping the reminder.
          const merged = { ...existing.row, ...patch }
          return storage.putOp(uid, { reminder_id: id, type: 'update', patch: pickColumns(merged), create_row: merged, base: null, queued_at: existing.queued_at, rev: existing.rev + 1, ...fresh() })
        }
        return storage.putOp(uid, { ...existing, row: { ...existing.row, ...patch }, rev: existing.rev + 1, ...fresh() })
      }
      return storage.putOp(uid, { ...existing, patch: { ...existing.patch, ...patch }, ...(existing.create_row ? { create_row: { ...existing.create_row, ...patch } } : {}), rev: existing.rev + 1, ...fresh() })
    })
    emit({ type: 'changed' })
    kick()
    return (await localView(uid)).find((r) => r.id === id)
  }

  async function remove(_table, id) {
    const uid = await requireUser()
    await withLock(async () => {
      const existing = await storage.getOp(uid, id)
      if (existing?.type === 'create' && !inflight.has(`${uid}:${id}`)) return storage.deleteOp(uid, id) // never reached the server
      const base = existing ? existing.base : await storage.getRow(uid, id)
      return storage.putOp(uid, { reminder_id: id, type: 'delete', base: base || null, queued_at: existing?.queued_at ?? now(), rev: (existing?.rev ?? 0) + 1, ...fresh() })
    })
    emit({ type: 'changed' })
    kick()
  }

  // ---------------------------------------------------------------- synchronization
  async function createRemote(row, id) {
    try {
      return { kind: 'created', row: await remote.create(row) }
    } catch (e) {
      if (String(e?.code) !== '23505') throw e
      const existing = await remote.get(id) // an earlier attempt already landed
      if (existing) return { kind: 'created', row: existing }
      throw Object.assign(new Error('That reminder id is already in use.'), { code: 'x_duplicate_foreign' })
    }
  }

  async function sendOp(op) {
    if (op.type === 'create') return createRemote(op.row, op.reminder_id)
    if (op.type === 'update') {
      const server = await remote.get(op.reminder_id)
      if (!server) return op.create_row ? createRemote(op.create_row, op.reminder_id) : { kind: 'gone' }
      const { apply, conflicts: clash } = mergeFields(op.base, op.patch, server)
      if (!Object.keys(apply).length) return { kind: 'noop', row: server, clash: clash.length }
      return { kind: 'updated', row: await remote.update(op.reminder_id, apply), clash: clash.length }
    }
    if (op.type === 'delete') {
      await remote.remove(op.reminder_id)
      return { kind: 'deleted' }
    }
    throw Object.assign(new Error('Unknown change type'), { code: '22000' })
  }

  const finishOk = (uid, op, res) =>
    withLock(async () => {
      if (res.row) await storage.putRow(uid, res.row)
      if (res.kind === 'deleted' || res.kind === 'gone') await storage.deleteRow(uid, op.reminder_id)
      conflicts += res.clash || 0
      if (res.kind === 'gone' && op.type === 'update') conflicts += 1 // my edit targeted a reminder that no longer exists on the server
      const cur = await storage.getOp(uid, op.reminder_id)
      if (!cur) return
      if (cur.rev === op.rev || res.kind === 'gone') return storage.deleteOp(uid, op.reminder_id)
      // Edited while this attempt was in flight: keep the newer change, re-based on what the server now holds.
      return storage.putOp(uid, { ...cur, base: res.row || cur.base, ...fresh() })
    })

  const finishFail = (uid, op, error, kind) =>
    withLock(async () => {
      const cur = await storage.getOp(uid, op.reminder_id)
      if (!cur || cur.rev !== op.rev || kind === 'auth') return // edited meanwhile, or paused for sign-in: no attempt used
      const attempts = cur.attempts + 1
      const failed = kind === 'permanent' || attempts >= maxAttempts
      return storage.putOp(uid, { ...cur, attempts, status: failed ? 'failed' : 'pending', next_attempt_at: failed ? 0 : now() + backoff(attempts), last_error: String(error?.message || 'error').slice(0, 200) })
    })

  async function processOp(uid, op) {
    const key = `${uid}:${op.reminder_id}`
    inflight.add(key)
    try {
      await finishOk(uid, op, await withTimeout(sendOp(op), timeoutMs))
      return 'ok'
    } catch (e) {
      const kind = classifyError(e)
      if (kind === 'gone') {
        await finishOk(uid, op, { kind: 'gone' })
        return 'ok'
      }
      await finishFail(uid, op, e, kind)
      return kind
    } finally {
      inflight.delete(key)
    }
  }

  /** Sends due changes. Only one run at a time. force = ignore backoff waits (used when the connection returns). */
  function sync({ force = false } = {}) {
    if (syncRun) return syncRun
    if (!userId || !isOnline()) return Promise.resolve({ skipped: true })
    syncRun = (async () => {
      const uid = userId
      const summary = { synced: 0, failed: 0, paused: false }
      const ops = (await storage.listOps(uid)).filter((o) => o.status === 'pending' && (force || o.next_attempt_at <= now()))
      for (const op of ops) {
        if (uid !== userId) break // the account changed: never send one user's data under another
        const result = await processOp(uid, op)
        if (result === 'ok') summary.synced++
        else summary.failed++
        if (result === 'auth') {
          summary.paused = true
          break
        }
      }
      emit({ type: 'synced', ...summary })
      return summary
    })().finally(() => {
      syncRun = null
    })
    return syncRun
  }

  // ---------------------------------------------------------------- status and housekeeping
  async function status() {
    if (!userId) return { pending: 0, failed: 0, conflicts: 0 }
    const ops = await storage.listOps(userId)
    return { pending: ops.filter((o) => o.status === 'pending').length, failed: ops.filter((o) => o.status === 'failed').length, conflicts }
  }
  const clearConflicts = () => { conflicts = 0; emit({ type: 'changed' }) }

  async function retryFailed() {
    const uid = await requireUser()
    await withLock(async () => {
      for (const op of await storage.listOps(uid)) if (op.status === 'failed') await storage.putOp(uid, { ...op, ...fresh() })
    })
    emit({ type: 'changed' })
    return sync({ force: true })
  }

  async function discardFailed() {
    const uid = await requireUser()
    await withLock(async () => {
      for (const op of await storage.listOps(uid)) if (op.status === 'failed') await storage.deleteOp(uid, op.reminder_id)
    })
    emit({ type: 'changed' })
  }

  /** Best effort before sign-out: try to send what is waiting, but never block sign-out for long. */
  async function flush(ms = 4000) {
    if (!userId || !isOnline()) return
    await Promise.race([sync({ force: true }), new Promise((r) => setTimeout(r, ms))]).catch(() => {})
  }

  function setUser(id) {
    const next = id || null
    if (next === userId) return
    userId = next
    conflicts = 0
    emit({ type: 'user' })
  }

  return {
    setUser, getUser: () => userId, list, create, update, remove, refresh, readLocal, sync, status, retryFailed, discardFailed, flush, clearConflicts,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    /** Sign-out / account switch: forget this user's cached rows but KEEP unsynced changes so nothing is lost. */
    leaveUser: (uid) => storage.clearUser(uid, { keepOps: true }),
    /** Account deletion: remove everything this user left on the phone, including unsynced changes. */
    purgeUser: (uid) => storage.clearUser(uid, { keepOps: false }),
  }
}

/** The shape useResource() expects (same methods as services/db.js), plus subscribe() for background refresh. */
export function createReminderAdapter(repo) {
  return {
    list: (table, opts) => repo.list(table, opts),
    create: (table, values) => repo.create(table, values),
    update: (table, id, values) => repo.update(table, id, values),
    remove: (table, id) => repo.remove(table, id),
    subscribe: (fn) => repo.subscribe(fn),
  }
}
