// Slice 1a: Smart Action Center. The database functions themselves are NOT executed here (no Postgres in this environment);
// an in-memory stand-in mirrors their documented behaviour so the CLIENT flow (claim -> run -> finish, snooze, wake, scheduling) is tested.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { applyPageFilters, doItCore, snoozeCore, wakeCore } from '../src/lib/smartActionCore.js'
import {
  CATEGORIES, CATEGORY_OF_TYPE, SNOOZE_ID_START, SNOOZE_MS, doItKey, isActionable, isOverdue, isSnoozeAlarmId, isSnoozed, isUpcoming,
  matchesFilter, requiresConfirm, searchPattern, snoozeAlarmId, typesOfCategory,
} from '../src/utils/smartActions.js'
import { createSnoozeScheduler } from '../src/services/snoozeScheduler.js'
import { createReminderNotifier } from '../src/native/localNotifications.js'
import { isReminderNotificationId, ID_START } from '../src/lib/reminderSchedule.js'
import { buildNotifications, dueAt } from '../src/utils/notificationRules.js'

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// ---- in-memory stand-in for the SQL functions in 006_smart_actions.sql ----
function fakeServer(rows, clock = { now: Date.now() }) {
  const log = []
  const byId = (id) => { const r = rows.find((x) => x.id === id); if (!r) throw new Error('not_found'); return r }
  const rpc = async (name, a) => {
    if (name === 'notification_begin_action') {
      const n = byId(a.p_notification)
      if (n.status === 'done') return { claimed: false, status: 'done', result: n.action_result }
      if (n.status === 'dismissed') return { claimed: false, status: 'dismissed' }
      if (n.status === 'running' && n.action_started_at > clock.now - 120000) return { claimed: false, status: 'running' }
      n.status = 'running'; n.action_started_at = clock.now; n.is_read = true
      n.claim = crypto.randomUUID()
      return { claimed: true, status: 'running', claim_id: n.claim, action_kind: n.action_kind, action_ref: n.action_ref, link: n.link }
    }
    if (name === 'notification_finish_action') {
      const n = byId(a.p_notification)
      if (n.status !== 'running' || n.claim !== a.p_claim) throw new Error('no_active_claim') // same rule as 009: only the live claim may finish
      if (a.p_ok) { n.status = 'done'; n.action_result = a.p_result; n.snoozed_until = null } else { n.status = 'open'; n.action_started_at = null }
      n.claim = null
      return { status: n.status }
    }
    if (name === 'notification_snooze') {
      const n = byId(a.p_notification)
      if (n.status === 'done' || n.status === 'dismissed') return { snoozed: false, status: n.status }
      if (n.snoozed_until && n.snoozed_until > clock.now) return { snoozed: true, duplicate: true, snoozed_until: new Date(n.snoozed_until).toISOString() }
      n.snoozed_until = clock.now + 5 * 60 * 1000; n.snooze_count = (n.snooze_count || 0) + 1; n.is_read = true
      log.push(a.p_key)
      return { snoozed: true, duplicate: false, snoozed_until: new Date(n.snoozed_until).toISOString() }
    }
    if (name === 'notification_wake_due') {
      const woke = rows.filter((n) => n.status === 'open' && n.snoozed_until && n.snoozed_until <= clock.now)
      for (const n of woke) { n.snoozed_until = null; n.is_read = false }
      return woke.map((n) => ({ ...n }))
    }
    throw new Error(`unexpected rpc ${name}`)
  }
  return { rpc, clock, log }
}
const row = (over = {}) => ({ id: U1, type: 'reminder', title: 'Pay rent', body: null, link: '/reminders', status: 'open', is_read: false, action_kind: 'complete_reminder', action_ref: { id: U2 }, snoozed_until: null, ...over })

// ---------- DO IT ----------
test('DO IT runs the action once and records the result', async () => {
  const rows = [row()]
  const s = fakeServer(rows)
  const ran = []
  const res = await doItCore(rows[0], { rpc: s.rpc, today: '2026-10-30', run: { complete_reminder: async (id) => { ran.push(id); return 'done' } } })
  assert.equal(res.status, 'done')
  assert.deepEqual(ran, [U2])
  assert.equal(rows[0].status, 'done')
  assert.equal(rows[0].action_result, 'done')
})

test('pressing DO IT twice, even at the same time, executes the action only once', async () => {
  const rows = [row()]
  const s = fakeServer(rows)
  let runs = 0
  const run = { complete_reminder: async () => { runs += 1; await new Promise((r) => setTimeout(r, 5)); return 'done' } }
  const results = await Promise.all([1, 2, 3].map(() => doItCore(rows[0], { rpc: s.rpc, today: 'x', run })))
  assert.equal(runs, 1)
  assert.equal(results.filter((r) => r.status === 'done').length, 1)
  assert.equal(results.filter((r) => r.status === 'duplicate').length, 2)
  // a later press (another device) is also a duplicate
  assert.equal((await doItCore(rows[0], { rpc: s.rpc, today: 'x', run })).status, 'duplicate')
  assert.equal(runs, 1)
})

test('a failing action releases the claim so the user can retry, and the error is shown', async () => {
  const rows = [row()]
  const s = fakeServer(rows)
  await assert.rejects(doItCore(rows[0], { rpc: s.rpc, today: 'x', run: { complete_reminder: async () => { throw new Error('network down') } } }), /network down/)
  assert.equal(rows[0].status, 'open')
  const ok = await doItCore(rows[0], { rpc: s.rpc, today: 'x', run: { complete_reminder: async () => 'done' } })
  assert.equal(ok.status, 'done')
})

test('a crashed claim (app killed mid-action) becomes claimable again after two minutes, not before', async () => {
  const rows = [row({ status: 'running', action_started_at: 1_000_000 })]
  const s = fakeServer(rows, { now: 1_000_000 + 60_000 })
  assert.equal((await doItCore(rows[0], { rpc: s.rpc, today: 'x', run: { complete_reminder: async () => 'done' } })).status, 'duplicate')
  s.clock.now = 1_000_000 + 121_000
  assert.equal((await doItCore(rows[0], { rpc: s.rpc, today: 'x', run: { complete_reminder: async () => 'done' } })).status, 'done')
})

test('DO IT never trusts the stored target: a missing or malformed id is refused and the claim released', async () => {
  for (const ref of [{}, { id: '../../etc' }, { id: 'abc' }]) {
    const rows = [row({ action_ref: ref })]
    await assert.rejects(doItCore(rows[0], { rpc: fakeServer(rows).rpc, today: 'x', run: { complete_reminder: async () => 'done' } }), /valid target/)
    assert.equal(rows[0].status, 'open')
  }
  const rows = [row({ action_kind: 'drop_database' })]
  await assert.rejects(doItCore(rows[0], { rpc: fakeServer(rows).rpc, today: 'x', run: {} }), /Unknown action/)
})

test('"open" notifications (budget, goal...) just navigate and are marked handled', async () => {
  const rows = [row({ type: 'budget', action_kind: 'open', action_ref: {}, link: '/finance' })]
  const res = await doItCore(rows[0], { rpc: fakeServer(rows).rpc, today: 'x', run: {} })
  assert.deepEqual([res.status, res.link], ['done', '/finance'])
})

test('only task completion asks for confirmation (it can create the next repeat)', () => {
  assert.equal(requiresConfirm('complete_task'), true)
  for (const k of ['complete_reminder', 'log_habit', 'open']) assert.equal(requiresConfirm(k), false)
  assert.equal(doItKey(U1), `doit:${U1}`)
})

// ---------- REMIND ME AFTER 5M ----------
test('snooze is exactly five minutes, from the server clock, and keeps the notification context', async () => {
  const rows = [row({ title: 'Pay rent', body: 'due today', action_ref: { id: U2 } })]
  const s = fakeServer(rows, { now: Date.parse('2026-10-30T10:00:00Z') })
  const res = await snoozeCore(rows[0], { rpc: s.rpc })
  assert.equal(res.snoozed, true)
  assert.equal(Date.parse(res.snoozed_until) - s.clock.now, SNOOZE_MS)
  assert.equal(SNOOZE_MS, 300000)
  assert.deepEqual([rows[0].title, rows[0].body, rows[0].action_ref.id, rows[0].link], ['Pay rent', 'due today', U2, '/reminders'])
})

test('pressing snooze again while one is pending does not stack or extend a reminder', async () => {
  const rows = [row()]
  const s = fakeServer(rows, { now: 10_000_000 })
  const a = await snoozeCore(rows[0], { rpc: s.rpc })
  s.clock.now += 60_000
  const b = await snoozeCore(rows[0], { rpc: s.rpc })
  assert.equal(b.duplicate, true)
  assert.equal(b.snoozed_until, a.snoozed_until)
  assert.equal(rows[0].snooze_count, 1)
})

test('snoozed notifications wake once after the five minutes, unread again, with their context', async () => {
  const rows = [row()]
  const s = fakeServer(rows, { now: 20_000_000 })
  await snoozeCore(rows[0], { rpc: s.rpc })
  assert.deepEqual(await wakeCore({ rpc: s.rpc }), [])
  s.clock.now += 4 * 60_000
  assert.deepEqual(await wakeCore({ rpc: s.rpc }), [])
  s.clock.now += 61_000
  const woke = await wakeCore({ rpc: s.rpc })
  assert.equal(woke.length, 1)
  assert.equal(woke[0].is_read, false)
  assert.equal(woke[0].action_ref.id, U2)
  assert.deepEqual(await wakeCore({ rpc: s.rpc }), [], 'a second wake never fires it twice')
})

test('a finished notification cannot be snoozed', async () => {
  const rows = [row({ status: 'done' })]
  assert.equal((await snoozeCore(rows[0], { rpc: fakeServer(rows).rpc })).snoozed, false)
})

// ---------- device scheduling ----------
function fakePlugin() {
  const pending = new Map()
  return { pending, cancel: async ({ notifications }) => notifications.forEach((n) => pending.delete(n.id)), schedule: async ({ notifications }) => notifications.forEach((n) => pending.set(n.id, n)) }
}

test('Android: snooze alarms use a stable id, so scheduling twice replaces instead of duplicating; the alarm has the action buttons', async () => {
  const plugin = fakePlugin()
  const sch = createSnoozeScheduler({ plugin })
  const n = { id: U1, title: 'Pay rent', body: 'due today' }
  await sch.schedule(n, '2026-10-30T10:05:00Z')
  await sch.schedule(n, '2026-10-30T10:05:00Z')
  assert.equal(plugin.pending.size, 1)
  const alarm = [...plugin.pending.values()][0]
  assert.equal(alarm.id, snoozeAlarmId(U1))
  assert.equal(alarm.actionTypeId, 'SMART_ACTION')
  assert.deepEqual(alarm.extra, { kind: 'smart', notificationId: U1 })
  assert.equal(alarm.schedule.allowWhileIdle, true)
  assert.equal(alarm.title, 'Pay rent')
})

test('snooze alarm ids never collide with reminder alarm ids, and stay valid Android ids', () => {
  for (let i = 0; i < 2000; i++) {
    const id = snoozeAlarmId(`${i}-${U1}`)
    assert.ok(isSnoozeAlarmId(id) && !isReminderNotificationId(id))
    assert.ok(id >= SNOOZE_ID_START && id < 2 ** 31 - 1)
  }
  assert.equal(snoozeAlarmId(U1), snoozeAlarmId(U1))
  assert.ok(SNOOZE_ID_START >= ID_START + 1_000_000_000)
})

test('after a restart, reconcile re-creates alerts only for still-snoozed notifications, and only once each', async () => {
  const plugin = fakePlugin()
  const now = Date.parse('2026-10-30T10:00:00Z')
  const sch = createSnoozeScheduler({ plugin, now: () => now })
  const rows = [{ id: U1, title: 'a', snoozed_until: '2026-10-30T10:03:00Z' }, { id: U2, title: 'b', snoozed_until: '2026-10-30T09:00:00Z' }, { id: 'x', title: 'c', snoozed_until: null }]
  assert.equal(await sch.reconcile(rows), 1)
  assert.equal(await sch.reconcile(rows), 1)
  assert.equal(plugin.pending.size, 1)
})

test('web: one timer per notification (re-scheduling replaces it), it fires once, and cancel clears it', async () => {
  const timers = new Map(); let next = 1; const fired = []
  const sch = createSnoozeScheduler({
    now: () => 0, setTimer: (fn, ms) => { const h = next++; timers.set(h, { fn, ms }); return h }, clearTimer: (h) => timers.delete(h), onFire: async (id) => fired.push(id),
  })
  await sch.schedule({ id: U1 }, new Date(300000).toISOString())
  await sch.schedule({ id: U1 }, new Date(300000).toISOString())
  assert.equal(timers.size, 1)
  assert.equal([...timers.values()][0].ms, 300000)
  await [...timers.values()][0].fn()
  assert.deepEqual(fired, [U1])
  await sch.schedule({ id: U2 }, new Date(300000).toISOString())
  await sch.cancel(U2)
  assert.equal(sch.pendingTimers(), 0)
})

test('web alerts carry the DO IT and REMIND ME AFTER 5M buttons; Android does not double-show', async () => {
  const shown = []
  const web = createSnoozeScheduler({ showWeb: async (n, o) => shown.push(o) })
  assert.equal(await web.present({ id: U1, title: 't' }), true)
  assert.deepEqual(shown[0].actions.map((a) => a.title), ['DO IT', 'REMIND ME AFTER 5M'])
  assert.deepEqual(shown[0].actions.map((a) => a.action), ['do', 'snooze'])
  assert.equal(await createSnoozeScheduler({ plugin: fakePlugin(), showWeb: async () => assert.fail() }).present({ id: U1 }), false)
})

test('Android reminder alarms get the same two action buttons (registered once, foreground so the app opens)', async () => {
  const calls = { types: null, scheduled: [] }
  const plugin = {
    checkPermissions: async () => ({ display: 'granted' }), createChannel: async () => {}, getPending: async () => ({ notifications: [] }), cancel: async () => {},
    registerActionTypes: async (a) => { calls.types = a }, schedule: async ({ notifications }) => calls.scheduled.push(...notifications),
  }
  const notifier = createReminderNotifier({ plugin, now: () => new Date('2026-10-30T08:00:00') })
  await notifier.reconcile([{ id: U1, title: 'Gym', description: null, remind_date: '2026-10-30', remind_time: '18:00', repeat_option: 'none', is_done: false }])
  assert.deepEqual(calls.types.types[0].actions.map((a) => [a.id, a.title, a.foreground]), [['do', 'DO IT', true], ['snooze', 'REMIND ME AFTER 5M', true]])
  assert.equal(calls.scheduled[0].actionTypeId, 'SMART_ACTION')
  assert.equal(calls.scheduled[0].extra.reminderId, U1)
})

// ---------- rules, filters, paging ----------
test('notification rules now carry an action, a target and a due time', () => {
  const today = '2026-10-30'
  const rows = buildNotifications({
    tasks: [{ id: U1, title: 'Report', status: 'todo', due_date: '2026-10-28' }],
    reminders: [{ id: U2, title: 'Call', is_done: false, remind_date: today, remind_time: '18:30:00' }],
  }, today, 600)
  const task = rows.find((r) => r.type === 'overdue_task'); const rem = rows.find((r) => r.type === 'reminder')
  assert.deepEqual([task.action_kind, task.action_ref], ['complete_task', { id: U1 }])
  assert.deepEqual([rem.action_kind, rem.action_ref], ['complete_reminder', { id: U2 }])
  assert.equal(rem.due_at, new Date(2026, 9, 30, 18, 30).toISOString())
  assert.equal(task.due_at, dueAt('2026-10-28'))
  assert.ok(rows.every((r) => r.dedupe_key && r.action_kind), 'every generated notification is actionable')
})

test('overdue / upcoming / unread / read classification', () => {
  const now = Date.parse('2026-10-30T12:00:00Z')
  const past = row({ due_at: '2026-10-30T09:00:00Z' }); const future = row({ due_at: '2026-10-30T18:00:00Z' })
  assert.deepEqual([isOverdue(past, now), isUpcoming(past, now), isOverdue(future, now), isUpcoming(future, now)], [true, false, false, true])
  const snoozed = row({ due_at: '2026-10-30T09:00:00Z', snoozed_until: '2026-10-30T12:03:00Z' })
  assert.equal(isSnoozed(snoozed, now), true)
  assert.equal(isOverdue(snoozed, now), false, 'a snoozed item is not nagging as overdue')
  assert.equal(isOverdue(row({ type: 'overdue_task', due_at: null }), now), true)
  assert.equal(isOverdue(row({ status: 'done', due_at: '2026-10-30T09:00:00Z' }), now), false)
  assert.equal(matchesFilter(row({ is_read: true }), 'read'), true)
  assert.equal(matchesFilter(row({ is_read: true }), 'unread'), false)
  assert.equal(isActionable(row({ action_kind: null })), false)
  assert.equal(isActionable(row({ status: 'done' })), false)
})

test('every category lists real notification types and every type has a category', () => {
  for (const c of CATEGORIES.filter((x) => x.value !== 'all')) assert.ok(typesOfCategory(c.value).length, c.value)
  for (const t of ['reminder', 'overdue_task', 'budget', 'goal_deadline', 'learning', 'ai', 'habit', 'project', 'briefing', 'weekly_review', 'community', 'appointment', 'payment', 'subscription', 'security']) assert.ok(CATEGORY_OF_TYPE[t], t)
  const sql = read('supabase/migrations/006_smart_actions.sql')
  for (const t of Object.keys(CATEGORY_OF_TYPE)) assert.ok(sql.includes(`'${t}'`), `type ${t} allowed by the database`)
})

test('paging builds keyset filters; search is sanitised so it cannot inject filter syntax', () => {
  const calls = []
  const b = new Proxy({}, { get: (_, m) => (...a) => { calls.push([m, ...a]); return b } })
  applyPageFilters(b, { filter: 'overdue', category: 'tasks', search: 'rent),id.eq.1', cursor: { created_at: '2026-10-30T10:00:00.123456+00:00', id: U1 }, now: new Date('2026-10-30T12:00:00Z') })
  const text = JSON.stringify(calls)
  assert.match(text, /"status","open"/)
  assert.match(text, /"in","type",\["overdue_task"\]/)
  assert.match(text, /created_at\.lt\.\\"2026-10-30T10:00:00\.123456\+00:00\\"/)
  assert.match(text, /and\(created_at\.eq\./)
  assert.equal(searchPattern('a%b_c(d),e."f"'), '%a b c d e f%')
  assert.equal(searchPattern('   '), '')
  assert.ok(!/id\.eq\.1/.test(text), 'the injected filter text was neutralised')
})

// ---------- wiring (static) ----------
test('Notifications screen: DO IT + REMIND ME AFTER 5M buttons, pagination, search, categories', () => {
  const page = read('src/pages/Notifications.jsx'); const card = read('src/components/notifications/NotificationCard.jsx')
  assert.match(card, /tr\('DO IT'\)/); assert.match(card, /tr\('REMIND ME AFTER 5M'\)/)
  assert.match(page, /fetchNotificationPage/); assert.match(page, /Load more/); assert.match(page, /CATEGORIES/); assert.match(page, /type="search"/)
  assert.ok(!/limit:\s*200/.test(page), 'the old fixed 200-row cap is gone')
  assert.match(read('src/utils/smartActions.js'), /FILTERS = \[[\s\S]*unread[\s\S]*read[\s\S]*overdue[\s\S]*upcoming/)
})
test('web service worker handles notification buttons without touching data', () => {
  const sw = read('public/sw-actions.js')
  assert.match(sw, /notificationclick/); assert.match(sw, /'do'/); assert.match(sw, /'snooze'/); assert.match(sw, /UUID\.test/)
  assert.ok(!/supabase|fetch\(/.test(sw), 'the worker never calls the API itself')
  assert.match(read('vite.config.js'), /importScripts: \['sw-actions\.js'\]/)
})
test('the app loop wakes snoozes and handles worker messages', () => {
  const layout = read('src/layouts/AppLayout.jsx')
  assert.match(layout, /useSnoozeLoop\(true\)/); assert.match(layout, /useNotificationActionMessages\(navigate\)/)
})
test('migration 006 is additive, idempotent, and keeps RLS in force', () => {
  const sql = read('supabase/migrations/006_smart_actions.sql')
  assert.ok(!/drop table|truncate|delete from/i.test(sql))
  assert.match(sql, /add column if not exists action_kind/)
  assert.match(sql, /interval '5 minutes'/)
  assert.match(sql, /unique \(user_id, idempotency_key\)/)
  assert.match(sql, /for update/)
  for (const f of ['notification_begin_action(uuid, text)', 'notification_finish_action(uuid, text, boolean, text)', 'notification_snooze(uuid, text)', 'notification_wake_due()']) {
    assert.ok(sql.includes(`revoke all on function public.${f} from public, anon`), f)
    assert.ok(sql.includes(`grant execute on function public.${f} to authenticated`), f)
  }
  assert.ok(!/security definer/i.test(sql), 'smart-action functions run with the caller rights, so RLS applies')
  assert.match(sql, /alter table public\.%I enable row level security/)
})
