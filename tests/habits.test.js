import assert from 'node:assert/strict'
import test from 'node:test'
import { completion, currentStreak, doneMap, habitInsights, habitSummary, isDue, longestStreak, overallCompletion } from '../src/utils/habits.js'

const TODAY = '2026-10-07' // a Wednesday
const daily = { id: 'h1', start_date: '2026-09-01', days_of_week: [0, 1, 2, 3, 4, 5, 6] }
const set = (...d) => new Set(d)

test('current streak counts consecutive done days up to today', () => {
  assert.equal(currentStreak(daily, set('2026-10-05', '2026-10-06', '2026-10-07'), TODAY), 3)
})
test('today not done yet does not break the streak', () => {
  assert.equal(currentStreak(daily, set('2026-10-04', '2026-10-05', '2026-10-06'), TODAY), 3)
})
test('a missed day ends the streak', () => {
  assert.equal(currentStreak(daily, set('2026-10-07', '2026-10-06', '2026-10-04'), TODAY), 2)
})
test('weekday-only habit skips the weekend when counting streaks', () => {
  const weekdays = { id: 'h2', start_date: '2026-09-01', days_of_week: [1, 2, 3, 4, 5] }
  assert.equal(isDue(weekdays, '2026-10-03'), false) // Saturday
  assert.equal(currentStreak(weekdays, set('2026-10-02', '2026-10-05', '2026-10-06'), TODAY), 3)
})
test('longest streak finds the best run in history', () => {
  const done = set('2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-20', '2026-09-21')
  assert.equal(longestStreak(daily, done, TODAY), 4)
})
test('habit is not due before its start date or after it is archived', () => {
  assert.equal(isDue({ ...daily, start_date: '2026-10-05' }, '2026-10-04'), false)
  assert.equal(isDue({ ...daily, archived_at: '2026-10-06T12:00:00Z' }, '2026-10-07'), false)
  assert.equal(isDue({ ...daily, archived_at: '2026-10-06T12:00:00Z' }, '2026-10-05'), true)
})
test('weekly and monthly completion use only days that have happened', () => {
  const s = habitSummary(daily, [{ entry_date: '2026-10-05' }, { entry_date: '2026-10-06' }], TODAY)
  assert.deepEqual(s.week, { due: 3, done: 2, rate: 67 }) // Mon-Wed so far
  assert.equal(s.month.due, 7)
  assert.equal(s.doneToday, false)
})
test('completion is null when nothing was due', () => {
  assert.equal(completion({ ...daily, start_date: '2026-10-20' }, set(), '2026-10-01', '2026-10-08', TODAY), null)
})
test('overall completion combines habits', () => {
  const map = doneMap([{ habit_id: 'h1', entry_date: '2026-10-07' }])
  const r = overallCompletion([daily], map, '2026-10-07', '2026-10-08', TODAY)
  assert.deepEqual(r, { due: 1, done: 1, rate: 100 })
})
test('insights say there is not enough history instead of inventing a pattern', () => {
  const s = habitSummary(daily, [], TODAY)
  assert.ok(habitInsights(s, TODAY).some((t) => /Not enough history|due days done/.test(t)))
})
