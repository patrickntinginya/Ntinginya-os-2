import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBriefing, daysSinceGoalActivity, focusGoal, lifeInsights } from '../src/utils/briefing.js'

const TODAY = '2026-10-07'
const t = (id, o = {}) => ({ id, title: id, status: 'todo', priority: 'medium', importance: 3, due_date: null, created_at: '2026-10-01T08:00:00Z', ...o })
const habit = { id: 'h', name: 'Learning', start_date: '2026-09-01', days_of_week: [0, 1, 2, 3, 4, 5, 6], created_at: '2026-09-01T08:00:00Z' }

test('empty data: briefing says there is nothing, never invents', () => {
  const b = buildBriefing({}, TODAY)
  assert.equal(b.hasData, false)
  assert.deepEqual(b.priorities, [])
  assert.equal(b.goalFocus, null)
  assert.equal(b.financeAlert, null)
})
test('briefing counts tasks, events and reminders from real rows', () => {
  const b = buildBriefing({
    tasks: [t('a', { due_date: TODAY }), t('b', { due_date: '2026-10-01' }), t('c', { due_date: '2026-10-20' })],
    events: [{ id: 'e', title: 'Meeting', event_date: TODAY, start_time: '10:00:00', end_time: '11:00:00', repeat_option: 'none' }],
    reminders: [{ id: 'r', title: 'Pay rent', remind_date: TODAY, is_done: false }],
  }, TODAY)
  assert.deepEqual(b.counts, { tasks: 2, dueToday: 1, overdue: 1, events: 1, reminders: 1 })
  assert.ok(b.priorities.length >= 1 && b.priorities.length <= 3)
})
test('goal focus: highest priority first, then nearest date', () => {
  const g = focusGoal([
    { id: '1', name: 'Low', status: 'active', priority: 'low', target_date: '2026-10-10' },
    { id: '2', name: 'High later', status: 'active', priority: 'high', target_date: '2026-12-01' },
    { id: '3', name: 'High sooner', status: 'active', priority: 'high', target_date: '2026-11-01' },
    { id: '4', name: 'Done', status: 'completed', priority: 'urgent' },
  ])
  assert.equal(g.name, 'High sooner')
})
test('briefing reports the goal focus with real progress and the habit streak', () => {
  const entries = ['05', '06', '07'].map((d) => ({ habit_id: 'h', entry_date: `2026-10-${d}` }))
  const b = buildBriefing({ goals: [{ id: 'g', name: 'Build Business', status: 'active', priority: 'high', progress: 64 }], habits: [habit], entries }, TODAY)
  assert.deepEqual(b.goalFocus, { name: 'Build Business', percent: 64 })
  assert.deepEqual(b.habit, { due: 1, done: 1, best: { name: 'Learning', streak: 3 } })
})
test('days since goal activity uses completed linked tasks and ticked milestones', () => {
  const goal = { id: 'g', created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-02T10:00:00Z' }
  assert.equal(daysSinceGoalActivity(goal, {}, TODAY), 35)
  assert.equal(daysSinceGoalActivity(goal, { tasks: [{ goal_id: 'g', completed_at: '2026-10-04T10:00:00Z' }] }, TODAY), 3)
})
test('insights: overdue tasks, over-budget, and a neglected top goal', () => {
  const out = lifeInsights({
    tasks: [t('a', { due_date: '2026-10-01' }), t('b', { due_date: '2026-10-02' }), t('c', { due_date: '2026-10-03' })],
    goals: [{ id: 'g', name: 'Launch', status: 'active', priority: 'high', created_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-20T10:00:00Z', progress: 10 }],
    budgets: [{ id: 'b', category: 'Food', amount: 100000 }], catThis: [{ category: 'Food', amount: 130000 }],
  }, TODAY).map((i) => i.text)
  assert.ok(out.includes('You have 3 overdue tasks.'))
  assert.ok(out.some((x) => x.includes('Food spending is above its monthly budget by TSh 30,000')))
  assert.ok(out.some((x) => x.includes('have not worked on your highest-priority goal "Launch" for 17 days')))
})
test('insights are empty when there is nothing to flag', () => assert.deepEqual(lifeInsights({}, TODAY), []))
