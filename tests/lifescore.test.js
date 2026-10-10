import assert from 'node:assert/strict'
import test from 'node:test'
import { DIMENSIONS, lifeScore, productivityRate } from '../src/utils/lifeScore.js'

const TODAY = '2026-10-07'
const task = (id, due, status, completed) => ({ id, title: id, due_date: due, status, completed_at: completed ? `${completed}T12:00:00Z` : null, priority: 'medium', importance: 3 })
const habit = { id: 'h', start_date: '2026-09-01', days_of_week: [0, 1, 2, 3, 4, 5, 6] }
const week = ['01', '02', '03', '04', '05', '06', '07'].map((d) => ({ habit_id: 'h', entry_date: `2026-10-${d}` }))

test('no data: overall is null and says so', () => {
  const r = lifeScore({}, TODAY)
  assert.equal(r.overall, null)
  assert.match(r.explanation, /Not enough data yet/)
  for (const d of DIMENSIONS) assert.equal(r.dimensions[d], null)
})
test('a single dimension is not enough for an overall score', () => {
  const r = lifeScore({ habits: [habit], entries: week }, TODAY)
  assert.equal(r.dimensions.habits.score, 100)
  assert.equal(r.overall, null)
})
test('productivity: completion 70% + overdue share 30%', () => {
  const tasks = [task('a', '2026-10-01', 'completed', '2026-10-01'), task('b', '2026-10-02', 'completed', '2026-10-02'), task('c', '2026-10-03', 'completed', '2026-10-03'), task('d', '2026-10-04', 'todo')]
  const r = lifeScore({ tasks }, TODAY)
  assert.equal(r.dimensions.productivity.score, 53) // 75*0.7 + 0*0.3
  assert.match(r.dimensions.productivity.why, /3 of 4 tasks due/)
})
test('overall is the average of the dimensions that have data (missing ones are left out, not zero)', () => {
  const tasks = [task('a', '2026-10-01', 'completed', '2026-10-01'), task('b', '2026-10-09', 'todo')]
  const r = lifeScore({ tasks, habits: [habit], entries: week }, TODAY)
  const p = r.dimensions.productivity.score
  assert.equal(r.overall, Math.round((p + r.dimensions.habits.score + (r.dimensions.planning?.score ?? 0) * (r.dimensions.planning ? 1 : 0)) / (r.dimensions.planning ? 3 : 2)))
  assert.equal(r.dimensions.finance, null)
})
test('finance: savings rate and budgets feed the score', () => {
  const data = { monthly: [{ month: '2026-10-01', income: 1000000, expenses: 800000 }], budgets: [{ id: 'b', category: 'Food', amount: 100000 }], catThis: [{ category: 'Food', amount: 50000 }] }
  const r = lifeScore(data, TODAY)
  assert.equal(r.dimensions.finance.score, 100) // rate 20% -> 100, budgets all ok -> 100
  const bad = lifeScore({ ...data, catThis: [{ category: 'Food', amount: 150000 }] }, TODAY)
  assert.equal(bad.dimensions.finance.score, 50)
})
test('learning: 3 study days in 7 scores full marks', () => {
  const data = { learning: [{ id: 'l', status: 'learning' }], sessions: ['2026-10-05', '2026-10-06', '2026-10-07'].map((d) => ({ session_date: d, minutes: 30 })) }
  assert.equal(lifeScore(data, TODAY).dimensions.learning.score, 100)
})
test('productivityRate is judged as of the given day', () => {
  const tasks = [task('t1', '2026-09-28', 'completed', '2026-10-02'), task('t2', '2026-09-29', 'completed', '2026-09-29')]
  assert.equal(productivityRate(tasks, '2026-09-30').rate, 50)
  assert.equal(productivityRate(tasks, '2026-10-07').rate, 100)
})
test('trend compares like with like and is null when the basis differs', () => {
  const tasks = [task('t1', '2026-09-28', 'completed', '2026-10-02'), task('t2', '2026-09-29', 'completed', '2026-09-29'), task('t3', '2026-10-05', 'completed', '2026-10-05')]
  assert.equal(lifeScore({ tasks }, TODAY).trend.change, 50)
  assert.equal(lifeScore({ tasks, habits: [{ ...habit, start_date: '2026-10-01' }], entries: week }, TODAY).trend, null)
})
