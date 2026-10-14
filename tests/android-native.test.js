// Android-only logic: reminder alarm planning, the notification wrapper (fake plugin), the coordinator, the manifest patch,
// the AI endpoint choice, restricted CORS, and checks that web behavior stays isolated from the native code.
// These prove the LOGIC with fakes. Nothing here proves a notification actually fires on a real phone.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { preflight, withCors, ALLOWED_ORIGINS, corsDecision } from '../api/_lib/ai/cors.js'
import { patchManifest, PERMISSIONS, SCHEME } from '../scripts/androidManifest.mjs'
import { normalizeApiBase, resolveAiEndpoint, AI_PATH } from '../src/lib/apiBase.js'
import {
  DEFAULT_TIME, HORIZON_DAYS, ID_START, isReminderNotificationId, localDateTime, MAX_PER_REMINDER, MAX_TOTAL, notificationId, occurrencesFor, planSchedule,
} from '../src/lib/reminderSchedule.js'
import { isUuid, uuidv4 } from '../src/lib/uuid.js'
import { createReminderNotifier, routeForNotification, TEST_NOTIFICATION_ID } from '../src/native/localNotifications.js'
import { createReminderCoordinator } from '../src/native/reminderCoordinator.js'
import { addInterval } from '../src/utils/date.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const NOW = new Date(2026, 9, 12, 8, 0, 0) // 12 Oct 2026, 08:00 device-local
const R1 = '00000000-0000-4000-8000-000000000001'
const R2 = '00000000-0000-4000-8000-000000000002'
const rem = (over = {}) => ({ id: R1, title: 'Pay rent', description: null, remind_date: '2026-10-12', remind_time: null, repeat_option: 'none', repeat_interval_days: null, is_done: false, ...over })
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

// ------------------------------------------------------------------------------------------------ schedule planning
test('a reminder without a time fires at the documented default (09:00 device-local)', () => {
  assert.equal(DEFAULT_TIME, '09:00')
  assert.deepEqual(occurrencesFor(rem(), NOW).map(fmt), ['2026-10-12 09:00'])
})

test('a reminder with a time uses the device-local wall clock, seconds ignored', () => {
  assert.deepEqual(occurrencesFor(rem({ remind_time: '14:30:00' }), NOW).map(fmt), ['2026-10-12 14:30'])
})

test('past times are skipped (never fired late), and completed reminders are never scheduled', () => {
  assert.deepEqual(occurrencesFor(rem({ remind_time: '07:59:00' }), NOW), [])
  assert.deepEqual(occurrencesFor(rem({ remind_date: '2026-10-01' }), NOW), [])
  assert.deepEqual(occurrencesFor(rem({ is_done: true, remind_date: '2026-10-20' }), NOW), [])
})

test('a reminder less than 5 seconds away is skipped so the alarm cannot be created already-late', () => {
  assert.deepEqual(occurrencesFor(rem({ remind_time: '08:00:03' }), NOW), [])
})

test('repeats use the SAME rule as the app (addInterval): daily, weekly, monthly, custom', () => {
  const daily = occurrencesFor(rem({ repeat_option: 'daily', remind_time: '10:00:00' }), NOW)
  assert.equal(daily.length, MAX_PER_REMINDER, 'bounded per reminder')
  assert.deepEqual(daily.slice(0, 3).map(fmt), ['2026-10-12 10:00', '2026-10-13 10:00', '2026-10-14 10:00'])

  const weekly = occurrencesFor(rem({ repeat_option: 'weekly', remind_time: '10:00:00' }), NOW)
  assert.deepEqual(weekly.map(fmt), ['2026-10-12 10:00', '2026-10-19 10:00', '2026-10-26 10:00', '2026-11-02 10:00', '2026-11-09 10:00'], 'only what fits in the 30-day window')

  const custom = occurrencesFor(rem({ repeat_option: 'custom', repeat_interval_days: 3, remind_time: '10:00:00' }), NOW)
  assert.deepEqual(custom.slice(0, 3).map(fmt), ['2026-10-12 10:00', '2026-10-15 10:00', '2026-10-18 10:00'])

  const monthly = occurrencesFor(rem({ repeat_option: 'monthly', remind_date: '2026-09-12', remind_time: '10:00:00' }), NOW)
  assert.deepEqual(monthly.map(fmt), ['2026-10-12 10:00', '2026-11-11 10:00'.replace('11-11', `11-${addInterval('2026-10-12', 'monthly').slice(8)}`)].slice(0, monthly.length))
})

test('a repeating reminder that started in the past schedules only FUTURE occurrences', () => {
  const out = occurrencesFor(rem({ repeat_option: 'daily', remind_date: '2026-01-01', remind_time: '10:00:00' }), NOW)
  assert.ok(out.length > 0 && out.every((d) => d > NOW))
  assert.equal(fmt(out[0]), '2026-10-12 10:00')
})

test('nothing is scheduled beyond the rolling window', () => {
  const out = occurrencesFor(rem({ repeat_option: 'daily', remind_time: '10:00:00' }), NOW, { perReminder: 1000 })
  assert.ok(out.at(-1) <= new Date(NOW.getTime() + HORIZON_DAYS * 86400000))
  assert.deepEqual(occurrencesFor(rem({ remind_date: '2027-03-01' }), NOW), [], 'a far-future one-off waits until it enters the window')
})

test('malformed dates and times never throw and never schedule', () => {
  assert.equal(localDateTime('2026-02-31', '09:00'), null)
  assert.equal(localDateTime('not-a-date', '09:00'), null)
  assert.equal(localDateTime('2026-10-12', '25:00'), null)
  assert.deepEqual(occurrencesFor(rem({ remind_date: 'garbage' }), NOW), [])
  assert.deepEqual(planSchedule(null, NOW), [])
  assert.deepEqual(planSchedule([null, {}, { id: R1 }], NOW), [])
})

test('ids are stable, unique, inside the reserved range, and valid for Android (below 2^31)', () => {
  const a = planSchedule([rem({ repeat_option: 'daily' }), rem({ id: R2, repeat_option: 'daily' })], NOW)
  const b = planSchedule([rem({ id: R2, repeat_option: 'daily' }), rem({ repeat_option: 'daily' })], NOW)
  assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id), 'order of input does not change ids')
  assert.equal(new Set(a.map((x) => x.id)).size, a.length)
  for (const { id } of a) {
    assert.ok(Number.isInteger(id) && id >= ID_START && id < 2 ** 31 - 1 && isReminderNotificationId(id))
  }
  assert.equal(isReminderNotificationId(TEST_NOTIFICATION_ID), false, 'the test notification is outside the reminder range')
  assert.equal(isReminderNotificationId(7), false)
  assert.equal(notificationId(R1, 0), notificationId(R1, 0))
})

test('total alarms are capped (rolling window), earliest first', () => {
  const many = Array.from({ length: 10 }, (_, i) => rem({ id: `00000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`, repeat_option: 'daily', remind_time: '10:00:00' }))
  const plan = planSchedule(many, NOW)
  assert.equal(plan.length, MAX_TOTAL)
  for (let i = 1; i < plan.length; i++) assert.ok(plan[i - 1].at <= plan[i].at)
})

test('two different reminders that hash to the same id group still get different ids', () => {
  // find a real collision of the id hash (about 10k tries expected)
  let seed = 12345
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0)
  const seen = new Map()
  let pair = null
  for (let i = 0; i < 400000 && !pair; i++) {
    const id = `00000000-0000-4000-8000-${String(rnd()).padStart(12, '0')}`
    const key = notificationId(id, 0)
    if (seen.has(key)) pair = [seen.get(key), id]
    else seen.set(key, id)
  }
  assert.ok(pair, 'a collision was found to test with')
  const plan = planSchedule(pair.map((id) => rem({ id, remind_time: '10:00:00' })), NOW)
  assert.equal(plan.length, 2)
  assert.notEqual(plan[0].id, plan[1].id)
})

// ------------------------------------------------------------------------------------------------ the notification wrapper
function fakePlugin({ display = 'granted', exact = 'granted' } = {}) {
  const p = {
    display, pending: new Map(), calls: [], listeners: [], channels: [],
    async checkPermissions() { return { display: p.display } },
    async requestPermissions() { p.calls.push('requestPermissions'); if (p.display === 'prompt') p.display = p.willGrant ? 'granted' : 'denied'; return { display: p.display } },
    async createChannel(c) { p.channels.push(c) },
    async getPending() { return { notifications: [...p.pending.values()].map((n) => ({ id: n.id })) } },
    async cancel({ notifications }) { p.calls.push('cancel'); for (const { id } of notifications) p.pending.delete(id) },
    async schedule({ notifications }) { p.calls.push('schedule'); for (const n of notifications) p.pending.set(n.id, n) },
    async checkExactNotificationSetting() { return { exact_alarm: exact } },
    async changeExactNotificationSetting() { p.calls.push('openExactSettings') },
    async addListener(name, fn) { p.listeners.push([name, fn]); return { remove() {} } },
  }
  return p
}
const notifier = (plugin) => createReminderNotifier({ plugin, now: () => NOW })

test('permission denied: nothing is scheduled, our old alarms are removed, and it never throws', async () => {
  for (const display of ['denied', 'prompt', 'prompt-with-rationale']) {
    const plugin = fakePlugin({ display })
    plugin.pending.set(ID_START + 5, { id: ID_START + 5 })
    const out = await notifier(plugin).reconcile([rem({ remind_time: '10:00:00' })])
    assert.equal(out.scheduled, 0)
    assert.equal(out.reason, 'permission_denied')
    assert.ok(!plugin.calls.includes('schedule'))
    assert.equal(plugin.pending.size, 0)
  }
})

test('the app asks for permission only when told to (a user action), never inside reconcile', async () => {
  const plugin = fakePlugin({ display: 'prompt' })
  await notifier(plugin).reconcile([rem()])
  assert.ok(!plugin.calls.includes('requestPermissions'))
  plugin.willGrant = true
  assert.equal(await notifier(plugin).requestPermission(), 'granted')
})

test('a plugin that throws reports "unsupported" instead of crashing the app', async () => {
  const n = createReminderNotifier({ plugin: { checkPermissions: async () => { throw new Error('not implemented') }, requestPermissions: async () => { throw new Error('x') } } })
  assert.equal(await n.permission(), 'unsupported')
  assert.equal(await n.requestPermission(), 'unsupported')
  assert.equal((await n.reconcile([rem()])).reason, 'permission_denied')
  assert.equal(await n.exactAlarmState(), 'unknown')
})

test('reconcile schedules the plan with stable ids; running it twice leaves exactly one alarm each (no duplicates)', async () => {
  const plugin = fakePlugin()
  const n = notifier(plugin)
  const list = [rem({ remind_time: '10:00:00' }), rem({ id: R2, title: 'Gym', remind_date: '2026-10-13', remind_time: '18:00:00' })]
  const first = await n.reconcile(list)
  const ids = [...plugin.pending.keys()].sort()
  const second = await n.reconcile(list)
  assert.equal(first.scheduled, 2)
  assert.equal(second.scheduled, 2)
  assert.deepEqual([...plugin.pending.keys()].sort(), ids)
  assert.equal(plugin.channels.length, 1, 'channel created once')
  const sample = [...plugin.pending.values()].find((x) => x.extra.reminderId === R1)
  assert.equal(sample.channelId, 'reminders')
  assert.equal(sample.schedule.allowWhileIdle, true)
  assert.equal(fmt(sample.schedule.at), '2026-10-12 10:00')
})

test('editing, completing and deleting a reminder cancels the obsolete alarm', async () => {
  const plugin = fakePlugin()
  const n = notifier(plugin)
  await n.reconcile([rem({ remind_time: '10:00:00' })])
  const [before] = [...plugin.pending.values()]
  await n.reconcile([rem({ remind_time: '11:15:00' })]) // edited time
  assert.equal(plugin.pending.size, 1)
  assert.equal(fmt([...plugin.pending.values()][0].schedule.at), '2026-10-12 11:15')
  assert.equal([...plugin.pending.values()][0].id, before.id, 'same stable id, replaced not duplicated')
  await n.reconcile([rem({ remind_time: '11:15:00', is_done: true })]) // completed
  assert.equal(plugin.pending.size, 0)
  await n.reconcile([rem({ remind_time: '11:15:00' })])
  await n.reconcile([]) // deleted
  assert.equal(plugin.pending.size, 0)
})

test('reconcile never cancels notifications that are not reminder alarms', async () => {
  const plugin = fakePlugin()
  plugin.pending.set(42, { id: 42 })
  plugin.pending.set(TEST_NOTIFICATION_ID, { id: TEST_NOTIFICATION_ID })
  await notifier(plugin).reconcile([])
  assert.ok(plugin.pending.has(42) && plugin.pending.has(TEST_NOTIFICATION_ID))
})

test('titles and bodies are bounded; a missing description uses the default body', async () => {
  const plugin = fakePlugin()
  await notifier(plugin).reconcile([rem({ title: 'T'.repeat(500), description: 'D'.repeat(900), remind_time: '10:00:00' }), rem({ id: R2, remind_time: '10:00:00' })])
  const all = [...plugin.pending.values()]
  assert.ok(all.every((x) => x.title.length <= 120 && x.body.length <= 240))
  assert.equal(all.find((x) => x.extra.reminderId === R2).body, 'Reminder')
})

test('disabling notifications cancels every reminder alarm', async () => {
  const plugin = fakePlugin()
  const n = notifier(plugin)
  await n.reconcile([rem({ remind_time: '10:00:00' })])
  await n.cancelAll()
  assert.equal(plugin.pending.size, 0)
})

test('test notification: refused without permission, scheduled with it, never inside the reminder id range', async () => {
  assert.deepEqual(await notifier(fakePlugin({ display: 'denied' })).scheduleTest(), { ok: false, reason: 'permission_denied' })
  const plugin = fakePlugin()
  assert.deepEqual(await notifier(plugin).scheduleTest(5), { ok: true })
  assert.equal([...plugin.pending.values()][0].id, TEST_NOTIFICATION_ID)
})

test('exact alarm state is reported, and the settings screen can be opened', async () => {
  const plugin = fakePlugin({ exact: 'denied' })
  const n = notifier(plugin)
  assert.equal(await n.exactAlarmState(), 'denied')
  await n.openExactAlarmSettings()
  assert.ok(plugin.calls.includes('openExactSettings'))
})

test('tapping a notification opens the reminder, and a forged id can only ever open the Reminders list', async () => {
  assert.equal(routeForNotification({ reminderId: R1 }), `/reminders?focus=${R1}`)
  for (const bad of [undefined, {}, { reminderId: '../../settings' }, { reminderId: 'javascript:alert(1)' }, { reminderId: R1 + '&x=1' }, { reminderId: 5 }]) {
    assert.equal(routeForNotification(bad), '/reminders')
  }
  const plugin = fakePlugin()
  const seen = []
  await notifier(plugin).onTap((r) => seen.push(r))
  const [name, fn] = plugin.listeners[0]
  assert.equal(name, 'localNotificationActionPerformed')
  fn({ notification: { extra: { reminderId: R1 } } })
  assert.deepEqual(seen, [`/reminders?focus=${R1}`])
})

// ------------------------------------------------------------------------------------------------ coordinator
test('coordinator: disabled cancels alarms and does not touch the network', async () => {
  const log = []
  const c = createReminderCoordinator({ repo: { refresh: async () => log.push('refresh'), readLocal: async () => [] }, notifier: { cancelAll: async () => log.push('cancelAll'), reconcile: async () => log.push('reconcile') } })
  assert.equal((await c.run({ enabled: false })).reason, 'disabled')
  assert.deepEqual(log, ['cancelAll'])
})

test('coordinator: enabled refreshes from the server first, then schedules from the local copy', async () => {
  const log = []
  const c = createReminderCoordinator({
    repo: { refresh: async () => log.push('refresh'), readLocal: async () => (log.push('readLocal'), [rem()]) },
    notifier: { cancelAll: async () => {}, reconcile: async (list) => (log.push(`reconcile:${list.length}`), { scheduled: 1 }) },
  })
  await c.run({ enabled: true })
  assert.deepEqual(log, ['refresh', 'readLocal', 'reconcile:1'])
})

test('coordinator: offline (refresh fails) still schedules from the local copy', async () => {
  let reconciled = 0
  const c = createReminderCoordinator({ repo: { refresh: async () => { throw new Error('offline') }, readLocal: async () => [rem()] }, notifier: { cancelAll: async () => {}, reconcile: async () => { reconciled++ } } })
  await c.run({ enabled: true })
  assert.equal(reconciled, 1)
})

test('coordinator: many triggers while busy collapse into exactly one follow-up run', async () => {
  let release
  const gate = new Promise((r) => (release = r))
  let runs = 0
  const c = createReminderCoordinator({ repo: { refresh: async () => { if (runs++ === 0) await gate }, readLocal: async () => [] }, notifier: { cancelAll: async () => {}, reconcile: async () => ({}) } })
  const first = c.run({ enabled: true })
  c.run({ enabled: true })
  c.run({ enabled: true })
  c.run({ enabled: true })
  release()
  await first
  assert.equal(runs, 2, 'one run in progress + one coalesced follow-up')
})

test('coordinator: when an account is left, alarms are cancelled and that user\'s cache is cleared', async () => {
  const log = []
  const c = createReminderCoordinator({ repo: { leaveUser: async (id) => log.push(`leave:${id}`) }, notifier: { cancelAll: async () => log.push('cancelAll') } })
  await c.userLeft('u1')
  assert.deepEqual(log, ['cancelAll', 'leave:u1'])
})

// ------------------------------------------------------------------------------------------------ Android manifest patch
// NOTE: this is a representative copy of the Capacitor 7 template written from the template's known structure.
// It has NOT been compared with a freshly generated android/ project (no network in the authoring environment).
const TEMPLATE = `<?xml version="1.0" encoding="utf-8" ?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:allowBackup="true" android:icon="@mipmap/ic_launcher" android:label="@string/app_name">
        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density"
            android:name=".MainActivity"
            android:label="@string/title_activity_main"
            android:theme="@style/AppTheme.NoActionBarLaunch"
            android:launchMode="singleTask"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`
test('manifest patch adds both deep-link hosts, the three permissions, and is idempotent', () => {
  const once = patchManifest(TEMPLATE)
  assert.equal(patchManifest(once), once, 'running it twice changes nothing')
  assert.match(once, new RegExp(`android:scheme="${SCHEME.replaceAll('.', '\\.')}" android:host="login"`))
  assert.match(once, /android:host="reset-password"/)
  assert.match(once, /android.intent.category.BROWSABLE/)
  for (const p of PERMISSIONS) assert.ok(once.includes(`android:name="${p}"`))
  assert.ok(once.includes('android.permission.INTERNET'), 'existing permission kept')
  assert.equal((once.match(/MAIN/g) || []).length, 1, 'the launcher filter is untouched')
})

test('manifest patch adds singleTask when missing, and refuses templates it does not understand', () => {
  const noLaunch = TEMPLATE.replace('            android:launchMode="singleTask"\n', '')
  assert.match(patchManifest(noLaunch), /android:launchMode="singleTask"/)
  assert.throws(() => patchManifest(TEMPLATE.replace('singleTask', 'standard')), /launchMode/)
  assert.throws(() => patchManifest('<manifest></manifest>'), /MainActivity not found/)
})

test('only the three agreed permissions are requested: no overlay, no accessibility, no app-blocking, no location, no storage', () => {
  assert.deepEqual([...PERMISSIONS].sort(), ['android.permission.POST_NOTIFICATIONS', 'android.permission.RECEIVE_BOOT_COMPLETED', 'android.permission.SCHEDULE_EXACT_ALARM'])
  const script = read('scripts/androidManifest.mjs') + read('scripts/android-configure.mjs')
  assert.doesNotMatch(script, /SYSTEM_ALERT_WINDOW|ACCESSIBILITY|PACKAGE_USAGE_STATS|QUERY_ALL_PACKAGES|LOCATION|STORAGE|READ_CONTACTS|CAMERA/)
})

// ------------------------------------------------------------------------------------------------ AI endpoint and CORS
test('web AI endpoint is exactly the relative path it always was', () => {
  assert.equal(AI_PATH, '/api/ai-chat')
  assert.deepEqual(resolveAiEndpoint({ native: false }), { url: '/api/ai-chat', configured: true })
  assert.deepEqual(resolveAiEndpoint({ native: false, apiBase: 'https://ignored.example' }), { url: '/api/ai-chat', configured: true })
})

test('native AI endpoint needs an explicit https origin; without one it is reported as not configured (no invented URL)', () => {
  assert.deepEqual(resolveAiEndpoint({ native: true }), { url: null, configured: false })
  assert.deepEqual(resolveAiEndpoint({ native: true, apiBase: '' }), { url: null, configured: false })
  assert.deepEqual(resolveAiEndpoint({ native: true, apiBase: 'https://app.example.com/' }), { url: 'https://app.example.com/api/ai-chat', configured: true })
  for (const bad of ['http://app.example.com', 'app.example.com', 'https://user:pw@app.example.com', 'javascript:alert(1)', 'ftp://x', 5, null]) {
    assert.equal(normalizeApiBase(bad), '', String(bad))
  }
})

test('a pasted base with a path/query is reduced to its origin, so the endpoint path is never duplicated', () => {
  for (const pasted of ['https://app.example.com/api/ai-chat', 'https://app.example.com/login', 'https://app.example.com/api/ai-chat/', 'https://app.example.com?x=1', 'https://app.example.com/#/x']) {
    assert.equal(normalizeApiBase(pasted), 'https://app.example.com', pasted)
    assert.equal(resolveAiEndpoint({ native: true, apiBase: pasted }).url, 'https://app.example.com/api/ai-chat')
  }
})

test('the AI client falls back gracefully and keeps bearer-token auth; no key or service-role name appears in client code', () => {
  const src = read('src/services/aiClient.js')
  assert.match(src, /Authorization: `Bearer \$\{token\}`/)
  assert.match(src, /if \(!url\) throw new AiUnavailableError/)
  assert.match(src, /if \(!url\) return \{ reachable: false, configured: false \}/)
  assert.doesNotMatch(src, /service_role|GEMINI|AI_API_KEY|apikey|x-api-key/i)
})

const req = (method, origin, extra = {}) => new Request('https://backend.example/api/ai-chat', { method, headers: { ...(origin ? { origin } : {}), ...extra } })
const decide = (r, env = {}) => corsDecision(r, env)

test('CORS preflight: the Android origin is allowed with exact-origin headers, never a wildcard', async () => {
  assert.deepEqual(ALLOWED_ORIGINS, ['https://localhost'])
  const r = req('OPTIONS', 'https://localhost', { 'access-control-request-method': 'POST' })
  const res = preflight(r, decide(r))
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://localhost')
  assert.equal(res.headers.get('vary'), 'Origin')
  assert.match(res.headers.get('access-control-allow-headers'), /authorization/)
  assert.notEqual(res.headers.get('access-control-allow-origin'), '*')
  assert.equal(res.headers.get('access-control-allow-credentials'), null, 'no cookie credentials are ever allowed')
})

test('CORS preflight from any other origin is refused with no CORS headers', async () => {
  for (const origin of ['https://evil.example', 'http://localhost', 'https://localhost.evil.example', 'capacitor://localhost', 'null']) {
    const r = req('OPTIONS', origin)
    const res = preflight(r, decide(r))
    assert.equal(res.status, 403, String(origin))
    assert.equal(res.headers.get('access-control-allow-origin'), null)
  }
})

test('non-OPTIONS requests are not intercepted by preflight', () => {
  const p = req('POST', 'https://localhost')
  assert.equal(preflight(p, decide(p)), null)
  const g = req('GET', undefined)
  assert.equal(preflight(g, decide(g)), null)
})

test('same-origin requests (the website itself) are never blocked, with or without an Origin header', () => {
  assert.equal(decide(req('POST', undefined)).blocked, false)
  const same = decide(req('POST', 'https://backend.example'))
  assert.equal(same.blocked, false)
  assert.equal(same.allowed, false, 'same origin needs no CORS headers')
})

test('extra origins come only from AI_ALLOWED_ORIGINS / Vercel host variables and must be https', () => {
  assert.equal(decide(req('POST', 'https://app.example.org'), { AI_ALLOWED_ORIGINS: 'https://app.example.org/, http://insecure.example' }).allowed, true)
  assert.equal(decide(req('POST', 'http://insecure.example'), { AI_ALLOWED_ORIGINS: 'http://insecure.example' }).blocked, true)
  assert.equal(decide(req('POST', 'https://my-app.vercel.app'), { VERCEL_PROJECT_PRODUCTION_URL: 'my-app.vercel.app' }).allowed, true)
  assert.equal(decide(req('POST', 'https://evil.example'), { AI_ALLOWED_ORIGINS: '*' }).blocked, true)
})

test('withCors: allowed origin gets headers; the website itself and the body stay untouched', async () => {
  const base = () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
  const allowed = withCors(base(), decide(req('POST', 'https://localhost')))
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://localhost')
  assert.equal(allowed.headers.get('content-type'), 'application/json')
  assert.equal(await allowed.text(), '{"ok":true}')
  const own = withCors(base(), decide(req('POST', undefined)))
  assert.equal(own.headers.get('access-control-allow-origin'), null)
  assert.equal(own.status, 200)
})

test('the AI endpoint is native Vercel: no Netlify imports; bearer-token check, limits and server-side keys intact', () => {
  const fn = read('api/_lib/ai/handler.js')
  const entry = read('api/ai-chat.js')
  assert.doesNotMatch(fn + entry, /netlify/i)
  assert.match(entry, /export default async function handler\(req, res\)/)
  assert.match(fn, /const early = preflight\(request, decision\)/)
  assert.match(fn, /authorization/i)
  assert.match(fn, /getUser\(/)
  assert.match(fn, /dailyLimit/)
  assert.doesNotMatch(fn, /SERVICE_ROLE|service_role/)
  assert.doesNotMatch(read('api/_lib/ai/cors.js').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n'), /['"]\*['"]/, 'no wildcard origin in code (comments excluded)')
})

// ------------------------------------------------------------------------------------------------ uuid
test('client UUIDs are valid v4 and unique, with a safe fallback when randomUUID is missing', () => {
  const a = uuidv4()
  assert.ok(isUuid(a) && a[14] === '4')
  assert.notEqual(a, uuidv4())
  const viaBytes = uuidv4({ getRandomValues: (b) => b.fill(7) })
  assert.ok(isUuid(viaBytes) && viaBytes[14] === '4' && '89ab'.includes(viaBytes[19]))
  assert.throws(() => uuidv4({}), /secure random/)
  assert.equal(isUuid("x'; drop table reminders;--"), false)
})

// ------------------------------------------------------------------------------------------------ web stays isolated from native code
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))
const srcFiles = walk(new URL('../src', import.meta.url).pathname).filter((f) => /\.(js|jsx)$/.test(f))

test('Capacitor packages are only ever loaded with dynamic import(), so the web bundle never executes them', () => {
  for (const f of srcFiles) {
    const text = readFileSync(f, 'utf8')
    assert.doesNotMatch(text, /^\s*import[^'"\n]*from\s*['"]@capacitor\//m, `${f} statically imports a Capacitor package`)
    assert.doesNotMatch(text, /require\(['"]@capacitor/, f)
  }
  const users = srcFiles.filter((f) => /import\(['"]@capacitor\//.test(readFileSync(f, 'utf8'))).map((f) => f.replace(/.*\/src\//, 'src/'))
  assert.deepEqual(users.sort(), ['src/native/NativeBridge.jsx', 'src/native/runtime.js'])
})

test('every native entry point is behind isNativePlatform(); the web notification path is kept', () => {
  assert.match(read('src/layouts/AppLayout.jsx'), /useDeviceNotifications\(Boolean\(profile\?\.notifications_enabled\) && !isNativePlatform\(\)\)/)
  assert.match(read('src/pages/Reminders.jsx'), /adapter: isNativePlatform\(\) \? reminderAdapter : undefined/)
  assert.match(read('src/pages/Reminders.jsx'), /\{isNativePlatform\(\) && <NativeSyncBanner \/>\}/)
  assert.match(read('src/pages/Notifications.jsx'), /isNativePlatform\(\) \? <NativeNotificationsCard \/> : <DeviceNotificationsCard \/>/)
  const bridge = read('src/native/NativeBridge.jsx')
  assert.match(bridge, /const native = isNativePlatform\(\)/)
  assert.equal((bridge.match(/if \(!native\b/g) || []).length, 4, 'all four effects return early on the web')
  const auth = read('src/contexts/AuthContext.jsx')
  assert.match(auth, /if \(isNativePlatform\(\)\) markAuthPending\('signup'\)/)
  assert.match(auth, /if \(isNativePlatform\(\)\) markAuthPending\('recovery'\)/)
  assert.match(auth, /if \(isNativePlatform\(\)\) await import\('\.\.\/native\/runtime'\)/)
  assert.match(read('src/pages/Settings.jsx'), /if \(isNativePlatform\(\)\) await import\('\.\.\/native\/runtime'\)/)
  assert.ok(readFileSync(new URL('../src/components/DeviceNotificationsCard.jsx', import.meta.url), 'utf8').length > 500, 'browser notification card still present')
})

test('web behavior of shared code is unchanged: db still talks to Supabase directly, and the service worker is still registered on web', () => {
  const db = read('src/services/db.js')
  assert.match(db, /supabase\.from\(table\)\.insert\(values\)\.select\(\)\.single\(\)/)
  assert.match(db, /supabase\.from\(table\)\.update\(values\)\.eq\('id', id\)\.select\(\)\.single\(\)/)
  assert.match(read('src/hooks/useResource.js'), /adapter = db/)
  assert.match(read('src/main.jsx'), /if \(!isNativePlatform\(\)\) registerSW\(\{ immediate: true \}\)/)
  const vite = read('vite.config.js')
  assert.match(vite, /VitePWA\(/)
  assert.doesNotMatch(vite, /capacitor|isNative/i)
})

test('only the documented VITE_ variables exist, and no AI or service-role name is exposed to the browser', () => {
  const allowed = new Set(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_API_BASE_URL'])
  for (const f of [...srcFiles, ...['.github/workflows/android-debug-apk.yml', 'capacitor.config.json', 'package.json'].map((p) => new URL(`../${p}`, import.meta.url).pathname)]) {
    for (const [name] of readFileSync(f, 'utf8').matchAll(/VITE_[A-Z0-9_]+/g)) assert.ok(allowed.has(name), `${f}: ${name}`)
  }
  assert.doesNotMatch(read('.github/workflows/android-debug-apk.yml'), /SERVICE_ROLE|GEMINI|AI_API_KEY|AI_PROVIDER/)
})

test('Swahili has a translation for every new Android user-facing string', () => {
  const phrases = read('src/i18n/sw.phrases.js')
  for (const f of ['src/native/NativeNotificationsCard.jsx', 'src/native/NativeSyncBanner.jsx', 'src/native/runtime.js', 'src/services/aiClient.js', 'src/pages/Reminders.jsx']) {
    for (const [, text] of read(f).matchAll(/\btr\('((?:[^'\\]|\\.)*)'/g)) {
      assert.ok(phrases.includes(JSON.stringify(text.replace(/\\'/g, "'"))) || phrases.includes(`"${text}"`), `${f}: missing Swahili for "${text}"`)
    }
  }
})

test('migrations: the three originals plus the additive V5 file only, and no SQL file mentions the Android code', () => {
  assert.deepEqual(readdirSync(new URL('../supabase/migrations', import.meta.url)).sort(), ['001_v1_foundation.sql', '002_v2.sql', '003_v3.sql', '004_v5.sql'])
  assert.deepEqual(readdirSync(new URL('../supabase', import.meta.url)).sort(), ['migrations', 'tests'])
})
