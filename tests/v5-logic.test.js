import test from 'node:test'
import assert from 'node:assert/strict'
import { doneMap } from '../src/utils/habits.js'
import { streakReport, safeDaysInRun, milestoneReached, nextMilestone, MILESTONES } from '../src/utils/streaks.js'
import { activePlan, planStatus, validatePlan, safeEntryRow, defaultEnd } from '../src/utils/safeMode.js'
import { validateReflection, groupByDate, canModify, filterEntries, writingStreak } from '../src/utils/reflections.js'
import { youTubeId, youTubeEmbedUrl, validateMedia, addItem, removeItem, toggleFavorite, loadState, saveState, MAX_ITEMS } from '../src/lib/media.js'
import * as C from '../src/lib/motivationContent.js'
import { addDays } from '../src/utils/date.js'
import en from '../src/i18n/en.js'
import sw from '../src/i18n/sw.js'

const H = { id: 'h1', name: 'Read', start_date: '2026-09-01', days_of_week: [0, 1, 2, 3, 4, 5, 6] }
const set = (...d) => new Set(d)
const TODAY = '2026-10-14'
const run = (n, end = '2026-10-13') => { const s = new Set(); for (let i = 0; i < n; i++) s.add(addDays(end, -i)); return s }

// ---------------- streaks
test('streak: consecutive days, today not yet done does not break it', () => {
  const r = streakReport(H, run(5), TODAY)
  assert.equal(r.current, 5)
  assert.equal(r.best, 5)
  assert.equal(r.needsRestart, false)
})
test('streak: completing the same day many times counts once (entries are grouped into a Set of dates)', () => {
  const entries = ['2026-10-13', '2026-10-13', '2026-10-13T09:00:00', '2026-10-12'].map((d) => ({ habit_id: 'h1', entry_date: d }))
  const done = doneMap(entries).get('h1')
  assert.equal(done.size, 2)
  assert.equal(streakReport(H, done, TODAY).current, 2)
})
test('streak: a miss ends the current run but never lowers the best run', () => {
  const done = new Set([...run(10, '2026-10-05'), '2026-10-13'])
  const r = streakReport(H, done, TODAY)
  assert.equal(r.current, 1)
  assert.equal(r.best, 10)
  assert.equal(r.lastMissed, '2026-10-12')
  assert.equal(r.daysSinceMiss, 2)
  assert.equal(r.comeback, true)
})
test('streak: recovery - yesterday missed and today still open means a fresh start is available (no shame wording, just state)', () => {
  const done = new Set(run(6, '2026-10-12'))
  done.delete('2026-10-13')
  const r = streakReport(H, done, TODAY)
  assert.equal(r.needsRestart, true)
  assert.equal(r.current, 0)
  assert.equal(r.best, 6)
})
test('streak: doing it today after a miss restarts at 1 and the new run is a comeback', () => {
  const r = streakReport(H, new Set([...run(4, '2026-10-11'), TODAY]), TODAY)
  assert.equal(r.current, 1)
  assert.equal(r.comeback, true)
  assert.equal(r.needsRestart, false)
})
test('streak: days that are not due (weekday habit) are skipped, not counted as misses', () => {
  const weekdays = { ...H, days_of_week: [1, 2, 3, 4, 5] } // Mon-Fri
  // 2026-10-09 is a Friday, 10-10/10-11 weekend, 10-12 Monday, 10-13 Tuesday, 10-14 Wednesday
  const r = streakReport(weekdays, set('2026-10-09', '2026-10-12', '2026-10-13'), TODAY)
  assert.equal(r.current, 3)
})
test('streak: local date strings are used as-is (no UTC shift): a late-night local date stays that date', () => {
  const r = streakReport(H, set('2026-10-14'), '2026-10-14')
  assert.equal(r.current, 1)
})
test('streak: never-missed habit has no lastMissed and a never-started habit has zero', () => {
  assert.equal(streakReport({ ...H, start_date: '2026-10-13' }, run(1), TODAY).lastMissed, null)
  const none = streakReport(H, new Set(), TODAY)
  assert.equal(none.current, 0)
  assert.equal(none.best, 0)
})
test('streak: a habit starting in the future has no streak and no miss', () => {
  const r = streakReport({ ...H, start_date: '2026-11-01' }, new Set(), TODAY)
  assert.equal(r.current, 0)
  assert.equal(r.needsRestart, false)
  assert.equal(r.lastMissed, null)
})
test('milestones: reached / next', () => {
  assert.equal(milestoneReached(2), null)
  assert.equal(milestoneReached(7), 7)
  assert.equal(milestoneReached(29), 14)
  assert.equal(nextMilestone(7), 14)
  assert.equal(nextMilestone(365), null)
  assert.deepEqual(MILESTONES, [...MILESTONES].sort((a, b) => a - b))
  assert.equal(streakReport(H, run(7), TODAY).milestone, 7)
})

// ---------------- Safe mode
test('safe mode: a smaller-version completion is a normal entry flagged safe_mode and DOES count; an empty day still does not', () => {
  const done = run(3, '2026-10-13')
  done.delete('2026-10-12') // missed
  assert.equal(streakReport(H, done, TODAY).current, 1)
  done.add('2026-10-12') // user later logs the mini version for that day
  assert.equal(streakReport(H, done, TODAY).current, 3)
  assert.deepEqual(safeEntryRow('h1', '2026-10-14'), { habit_id: 'h1', entry_date: '2026-10-14', safe_mode: true })
})
test('safe mode: safeDaysInRun counts only flagged days of the current run', () => {
  const done = run(5)
  assert.equal(safeDaysInRun(H, done, set('2026-10-13', '2026-10-12', '2026-09-01'), TODAY), 2)
})
test('safe mode: plan validation', () => {
  assert.equal(validatePlan({ mini_version: '  ' }, TODAY).error, 'safe.err.mini')
  assert.equal(validatePlan({ mini_version: 'x'.repeat(201) }, TODAY).error, 'safe.err.long')
  assert.equal(validatePlan({ mini_version: 'Read 1 page', planned_end: '2026-10-01' }, TODAY).error, 'safe.err.date')
  assert.equal(validatePlan({ mini_version: 'Read 1 page', planned_end: '2027-12-01' }, TODAY).error, 'safe.err.date')
  assert.equal(validatePlan({ mini_version: 'Read 1 page', planned_end: 'soon' }, TODAY).error, 'safe.err.date')
  const ok = validatePlan({ mini_version: ' Read 1 page ', planned_end: defaultEnd(TODAY), recovery_note: '' }, TODAY)
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.values, { mini_version: 'Read 1 page', recovery_note: null, planned_end: '2026-10-21', started_on: TODAY })
})
test('safe mode: only an un-exited plan is active; expired plans are flagged, not silently ended', () => {
  const plans = [{ id: 'p1', habit_id: 'h1', exited_on: '2026-10-01' }, { id: 'p2', habit_id: 'h1', exited_on: null, planned_end: '2026-10-10' }]
  assert.equal(activePlan(plans, 'h1').id, 'p2')
  assert.equal(activePlan(plans, 'h2'), null)
  assert.equal(planStatus(plans[1], TODAY), 'expired')
  assert.equal(planStatus({ planned_end: null }, TODAY), 'active')
})

// ---------------- reflections
test('reflection validation: needs some content, trims, limits, no future dates', () => {
  assert.equal(validateReflection({}, TODAY).error, 'refl.err.empty')
  assert.equal(validateReflection({ went_well: '   ' }, TODAY).error, 'refl.err.empty')
  assert.equal(validateReflection({ mood: 9 }, TODAY).error, 'refl.err.scale')
  assert.equal(validateReflection({ mood: 3, entry_date: '2026-10-20' }, TODAY).error, 'refl.err.future')
  assert.equal(validateReflection({ went_well: 'x'.repeat(4001) }, TODAY).error, 'refl.err.long')
  const ok = validateReflection({ mood: '4', energy: '', went_well: ' Walked ', tomorrow_action: 'Call Asha' }, TODAY)
  assert.deepEqual(ok.values, { entry_date: TODAY, kind: 'daily', mood: 4, energy: null, went_well: 'Walked', difficult: null, tomorrow_action: 'Call Asha', note: null })
  assert.ok(!('user_id' in ok.values), 'ownership is set by the database, never by the client')
})
test('reflection list: grouped by date newest first, search works, ownership guard', () => {
  const e = [
    { id: 1, user_id: 'u', entry_date: '2026-10-12', created_at: '2026-10-12T08:00:00Z', went_well: 'Gym' },
    { id: 2, user_id: 'u', entry_date: '2026-10-13', created_at: '2026-10-13T08:00:00Z', difficult: 'Budget' },
    { id: 3, user_id: 'u', entry_date: '2026-10-13', created_at: '2026-10-13T20:00:00Z', went_well: 'Read' },
  ]
  const g = groupByDate(e)
  assert.deepEqual(g.map((x) => x.date), ['2026-10-13', '2026-10-12'])
  assert.deepEqual(g[0].items.map((x) => x.id), [3, 2])
  assert.equal(filterEntries(e, 'bud').length, 1)
  assert.equal(canModify(e[0], 'u'), true)
  assert.equal(canModify(e[0], 'someone-else'), false)
  assert.equal(canModify(e[0], null), false)
  assert.equal(writingStreak(e, '2026-10-14', addDays), 2)
})

// ---------------- media
test('YouTube parsing accepts real link shapes only', () => {
  const id = 'dQw4w9WgXcQ'
  for (const u of [`https://www.youtube.com/watch?v=${id}`, `https://youtu.be/${id}`, `https://m.youtube.com/watch?v=${id}&t=1`, `https://www.youtube.com/embed/${id}`, `https://www.youtube.com/shorts/${id}`]) assert.equal(youTubeId(u), id, u)
  for (const u of ['http://youtu.be/dQw4w9WgXcQ', 'https://evil.example/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=short', 'javascript:alert(1)', '', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ']) assert.equal(youTubeId(u), null, u)
  assert.equal(youTubeEmbedUrl(id), `https://www.youtube-nocookie.com/embed/${id}?rel=0`)
  assert.ok(!/autoplay/i.test(youTubeEmbedUrl(id)), 'never autoplay')
  assert.equal(youTubeEmbedUrl('bad'), null)
})
test('media validation: https only, direct audio/image files only, other video sites open externally', () => {
  assert.equal(validateMedia('audio', 'http://x.example/a.mp3').error, 'media.err.https')
  assert.equal(validateMedia('audio', 'https://x.example/page.html').error, 'media.err.audio')
  assert.equal(validateMedia('audio', 'https://x.example/a.MP3').ok, true)
  assert.equal(validateMedia('image', 'https://x.example/p.png').ok, true)
  assert.equal(validateMedia('image', 'https://x.example/p').error, 'media.err.image')
  assert.equal(validateMedia('video', 'https://vimeo.com/123').meta.youtubeId, null)
  assert.equal(validateMedia('video', 'https://u:p@x.example/v').error, 'media.err.https')
  assert.equal(validateMedia('nope', 'https://x.example/a').error, 'media.err.kind')
})
test('media list: add, duplicate, remove (also clears favourite), favourite toggle, capacity', () => {
  let s = { items: [], favorites: [] }
  let r = addItem(s, { kind: 'audio', title: 'Calm', url: 'https://x.example/a.mp3' }, 'i1')
  assert.equal(r.ok, true); s = r.state
  assert.equal(addItem(s, { kind: 'audio', title: 'Again', url: 'https://x.example/a.mp3' }, 'i2').error, 'media.err.dup')
  assert.equal(addItem(s, { kind: 'audio', title: '', url: 'https://x.example/b.mp3' }, 'i3').error, 'media.err.title')
  s = toggleFavorite(s, 'i1'); assert.deepEqual(s.favorites, ['i1'])
  s = removeItem(s, 'i1'); assert.deepEqual(s, { items: [], favorites: [] })
  const full = { items: Array.from({ length: MAX_ITEMS }, (_, i) => ({ id: `x${i}`, kind: 'audio', title: 't', url: `https://x.example/${i}.mp3` })), favorites: [] }
  assert.equal(addItem(full, { kind: 'audio', title: 'More', url: 'https://x.example/more.mp3' }, 'z').error, 'media.err.full')
})
test('media storage: round trip, corrupt or unsafe stored data is ignored, blocked storage does not throw', () => {
  const mem = () => { const d = {}; return { getItem: (k) => d[k] ?? null, setItem: (k, v) => { d[k] = v }, d } }
  const st = mem()
  assert.equal(saveState(st, 'u1', { items: [{ id: 'a', kind: 'image', title: 't', url: 'https://x.example/a.png' }], favorites: ['a'] }), true)
  assert.equal(loadState(st, 'u1').items.length, 1)
  assert.equal(loadState(st, 'u2').items.length, 0, 'state is scoped per user')
  st.d['life-os-motivation:u3'] = JSON.stringify({ items: [{ id: 'b', kind: 'image', title: 't', url: 'javascript:alert(1)' }] })
  assert.equal(loadState(st, 'u3').items.length, 0)
  st.d['life-os-motivation:u4'] = '{not json'
  assert.deepEqual(loadState(st, 'u4'), { items: [], favorites: [] })
  assert.equal(saveState({ setItem() { throw new Error('quota') } }, 'u', {}), false)
  assert.deepEqual(loadState(undefined, 'u'), { items: [], favorites: [] })
})

// ---------------- content
test('built-in content is bilingual, ids are unique, and no media is fabricated', () => {
  for (const list of [C.DAILY, C.MORNING, C.NIGHT, C.MORNING_ROUTINE, C.NIGHT_ROUTINE, C.REASSURANCE, C.GROUNDING, C.NEXT_ACTIONS]) {
    assert.ok(list.length >= 3)
    for (const x of list) { assert.ok(x.en?.length > 5 && x.sw?.length > 5, JSON.stringify(x)) }
  }
  for (const x of C.DAILY) assert.ok(x.action.en && x.action.sw)
  for (const list of [C.DAILY, C.MORNING, C.NIGHT, C.NEXT_ACTIONS]) assert.equal(new Set(list.map((x) => x.id)).size, list.length)
  for (const list of [C.CURATED_VIDEOS, C.CURATED_AUDIO, C.CURATED_IMAGES]) for (const m of list) assert.ok(/^https:\/\//.test(m.url), 'curated media must be https')
  assert.equal(C.CURATED_VIDEOS.length + C.CURATED_AUDIO.length + C.CURATED_IMAGES.length, 0, 'no media is bundled unless the owner adds verified links')
})
test('daily message is stable within a day, changes the next day, and always in range', () => {
  assert.equal(C.dailyFor('2026-10-14').id, C.dailyFor('2026-10-14').id)
  assert.notEqual(C.dailyFor('2026-10-14').id, C.dailyFor('2026-10-15').id)
  for (let i = 0; i < 400; i++) assert.ok(C.dailyFor(addDays('2026-01-01', i)))
})
test('emergency content makes no medical or automatic-contact claims', () => {
  const all = JSON.stringify([C.REASSURANCE, C.GROUNDING, C.NEXT_ACTIONS]).toLowerCase()
  for (const bad of ['diagnos', 'treat', 'cure', 'we will call', 'alert sent', 'contacting emergency', 'ambulance']) assert.ok(!all.includes(bad), bad)
})
test('every new translation key exists in both languages with the same placeholders', () => {
  const keys = Object.keys(en).filter((k) => /^(mot|safe|refl|calm|media|streak|ritual)\./.test(k))
  assert.ok(keys.length > 60, `expected many V5 keys, found ${keys.length}`)
  const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
  for (const k of keys) { assert.ok(k in sw, `sw missing ${k}`); assert.equal(ph(en[k]), ph(sw[k]), k) }
  for (const k of Object.keys(sw).filter((k) => /^(mot|safe|refl|calm|media|streak|ritual)\./.test(k))) assert.ok(k in en, `en missing ${k}`)
})
