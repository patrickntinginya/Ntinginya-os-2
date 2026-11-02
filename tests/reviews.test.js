import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDailyReview, buildWeeklyReview, freeMinutes, NOT_ENOUGH } from '../src/utils/reviews.js'
import { effectiveProgress } from '../src/utils/goals.js'
import { cleanTerm } from '../src/utils/searchTerm.js'

const today = '2026-10-07' // Wednesday
const task = (o) => ({ id: Math.random().toString(36).slice(2), title: 't', status: 'todo', priority: 'medium', importance: 3, due_date: null, goal_id: null, ...o })

test('freeMinutes subtracts event time and ignores overlaps once', () => {
  assert.equal(freeMinutes([]), 720)
  assert.equal(freeMinutes([{ start_time: '09:00', end_time: '10:00' }]), 660)
  assert.equal(freeMinutes([{ start_time: '09:00', end_time: '11:00' }, { start_time: '10:00', end_time: '12:00' }]), 540)
})

test('daily review with no data says so instead of inventing content', () => {
  const r = buildDailyReview({}, today)
  assert.equal(r.hasAnyData, false)
  assert.equal(r.learning, NOT_ENOUGH)
  assert.deepEqual(r.goals, [NOT_ENOUGH])
  assert.deepEqual(r.suggested, [])
  assert.equal(r.finance[0], NOT_ENOUGH)
})

test('daily review reports overlap conflicts and too little free time', () => {
  const eventsToday = [
    { id: 'a', title: 'Class', occurrence_date: today, start_time: '09:00', end_time: '11:00' },
    { id: 'b', title: 'Call', occurrence_date: today, start_time: '10:00', end_time: '10:30' },
    { id: 'c', title: 'Workshop', occurrence_date: today, start_time: '11:00', end_time: '19:30' },
  ]
  const tasks = [task({ title: 'A', due_date: today }), task({ title: 'B', due_date: today }), task({ title: 'C', due_date: '2026-10-01' })]
  const r = buildDailyReview({ tasks, eventsToday }, today)
  assert.ok(r.conflicts.some((c) => c.includes('"Class" and "Call" overlap')))
  assert.ok(r.conflicts.some((c) => /only about \d+ minutes are open/.test(c)))
  assert.equal(r.matters.priorities.length, 3)
})

test('weekly review counts only this week and is honest when empty', () => {
  const empty = buildWeeklyReview({}, today)
  assert.equal(empty.wentWell[0], NOT_ENOUGH)
  assert.equal(empty.finance.hasData, false)
  assert.equal(empty.productivity.rate, null)

  const r = buildWeeklyReview({
    tasks: [
      task({ status: 'completed', completed_at: '2026-10-06T08:00:00', due_date: '2026-10-06' }),
      task({ title: 'Late', due_date: '2026-10-02' }),
    ],
    weekIncome: [{ amount: 100000, category: 'salary', entry_date: '2026-10-05' }],
    weekExpenses: [{ amount: 30000, category: 'food', entry_date: '2026-10-06' }, { amount: 20000, category: 'transport', entry_date: '2026-10-06' }],
    sessions: [{ session_date: '2026-10-05', minutes: 30 }, { session_date: '2026-10-06', minutes: 45 }, { session_date: '2026-10-07', minutes: 20 }],
  }, today)
  assert.equal(r.productivity.completed, 1)
  assert.equal(r.productivity.overdue, 1)
  assert.equal(r.finance.savings, 50000)
  assert.equal(r.finance.topCategories[0].category, 'food')
  assert.equal(r.learning.minutes, 95)
  assert.equal(r.learning.days, 3)
  assert.ok(r.wentWell.some((w) => w.includes('3 days')))
  assert.ok(r.needsWork.some((w) => w.includes('1 task overdue')))
})

test('goal progress follows milestones when present', () => {
  const g = { id: 'g1', progress: 10 }
  assert.equal(effectiveProgress(g, []), 10)
  assert.equal(effectiveProgress(g, [{ goal_id: 'g1', is_done: true }, { goal_id: 'g1', is_done: false }, { goal_id: 'x', is_done: true }]), 50)
})

test('search terms are stripped of filter-breaking characters', () => {
  assert.equal(cleanTerm('a,b(c)%*:"x"'), 'a b c x')
  assert.equal(cleanTerm('  hi  there '), 'hi there')
  assert.equal(cleanTerm(null), '')
})
