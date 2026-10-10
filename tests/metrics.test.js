import test from 'node:test'
import assert from 'node:assert/strict'
import {
  taskStats, expandEvents, findConflicts, budgetUsage, budgetLevel, totalsByCategory, savingsRate,
  savingsPlan, goalsNeedingAttention, dailyInsight, nextActionForGoal, completedPerWeek, recommendNextTopic,
} from '../src/utils/metrics.js'
import { recommendPriority, rankTasks } from '../src/utils/priority.js'
import { addMonths, nextOccurrence, startOfWeek, addDays } from '../src/utils/date.js'

const TODAY = '2026-10-07' // a Wednesday

test('week starts on Monday', () => {
  assert.equal(startOfWeek('2026-10-07'), '2026-10-05')
  assert.equal(startOfWeek('2026-10-04'), '2026-09-28') // Sunday belongs to the previous week
})

test('month arithmetic clamps to month end', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29')
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15')
})

test('repeating reminders roll to a date that is today or later', () => {
  assert.equal(nextOccurrence('2026-10-01', 'daily', null, TODAY), '2026-10-07')
  assert.equal(nextOccurrence('2026-10-01', 'weekly', null, TODAY), '2026-10-08')
  assert.equal(nextOccurrence('2026-10-01', 'custom', 3, TODAY), '2026-10-07')
  assert.equal(nextOccurrence('2026-10-01', 'none', null, TODAY), '2026-10-01')
})

test('task stats count only real tasks', () => {
  const tasks = [
    { id: 1, status: 'todo', due_date: '2026-10-07' },
    { id: 2, status: 'in_progress', due_date: '2026-10-03' },
    { id: 3, status: 'todo', due_date: null },
    { id: 4, status: 'cancelled', due_date: '2026-10-06' },
    { id: 5, status: 'completed', due_date: '2026-10-06', completed_at: '2026-10-06T10:00:00' },
  ]
  const s = taskStats(tasks, TODAY)
  assert.equal(s.open, 3)
  assert.equal(s.dueToday.length, 1)
  assert.equal(s.overdue.length, 1)
  assert.equal(s.completedThisWeek, 1)
  assert.equal(s.dueThisWeekCount, 2) // tasks 1 and 5; task 2 is last week, task 4 is cancelled
})

test('completion rate is null (not zero) when nothing was due', () => {
  assert.equal(taskStats([], TODAY).weekCompletionRate, null)
})

test('completed per week returns n buckets, oldest first', () => {
  const r = completedPerWeek([], TODAY, 4)
  assert.equal(r.length, 4)
  assert.equal(r[3].week, '2026-10-05')
})

test('repeating events expand and respect repeat_until', () => {
  const ev = [{ id: 'a', title: 'Gym', event_date: '2026-10-01', start_time: '07:00', repeat_option: 'weekly', repeat_until: '2026-10-20' }]
  const occ = expandEvents(ev, '2026-10-01', '2026-10-31')
  assert.deepEqual(occ.map((o) => o.occurrence_date), ['2026-10-01', '2026-10-08', '2026-10-15'])
  const monthly = expandEvents([{ id: 'b', event_date: '2026-01-31', start_time: '09:00', repeat_option: 'monthly' }], '2026-02-01', '2026-03-31')
  assert.deepEqual(monthly.map((o) => o.occurrence_date), ['2026-02-28', '2026-03-31'])
})

test('conflicts are found only when times overlap on the same day', () => {
  const occ = [
    { id: 1, occurrence_date: TODAY, start_time: '09:00', end_time: '10:00' },
    { id: 2, occurrence_date: TODAY, start_time: '09:30', end_time: '10:30' },
    { id: 3, occurrence_date: TODAY, start_time: '10:00', end_time: '11:00' },
    { id: 4, occurrence_date: '2026-10-08', start_time: '09:30', end_time: '10:30' },
  ]
  const pairs = findConflicts(occ).map(([a, b]) => `${a.id}-${b.id}`)
  assert.deepEqual(pairs, ['1-2', '2-3'])
})

test('budget usage and warning levels (70 / 90 / 100)', () => {
  assert.equal(budgetLevel(69), 'ok')
  assert.equal(budgetLevel(70), 'warning')
  assert.equal(budgetLevel(90), 'critical')
  assert.equal(budgetLevel(100), 'over')
  const usage = budgetUsage(
    [{ id: 1, category: 'Food', amount: '200000' }, { id: 2, category: 'transport', amount: 50000 }],
    [{ category: 'food', amount: 145000 }, { category: 'FOOD', amount: 5000 }, { category: 'transport', amount: 60000 }],
  )
  const food = usage.find((u) => u.category === 'Food')
  assert.equal(food.spent, 150000)
  assert.equal(food.remaining, 50000)
  assert.equal(food.percent, 75)
  assert.equal(food.level, 'warning')
  assert.equal(usage.find((u) => u.category === 'transport').level, 'over')
})

test('category totals and savings rate', () => {
  assert.deepEqual(totalsByCategory([{ category: 'Food', amount: 1000 }, { category: 'food', amount: 500 }, { category: 'x', amount: 2000 }]).map((c) => c.category), ['x', 'food'])
  assert.equal(savingsRate(1500000, 650000), 57)
  assert.equal(savingsRate(0, 100), null)
})

test('savings plan recommends weekly and monthly amounts from real dates', () => {
  const plan = savingsPlan({ target_amount: 2000000, current_amount: 750000, target_date: '2026-12-31' }, '2026-10-07')
  assert.equal(plan.remaining, 1250000)
  assert.ok(plan.weekly > 0 && plan.monthly > plan.weekly)
  assert.equal(savingsPlan({ target_amount: 1000, current_amount: 1000 }, TODAY).done, true)
  assert.equal(savingsPlan({ target_amount: 1000, current_amount: 0 }, TODAY).noDate, true)
  assert.equal(savingsPlan({ target_amount: 1000, current_amount: 0, target_date: '2026-10-01' }, TODAY).passed, true)
})

test('goal attention only reports real reasons', () => {
  const goals = [
    { id: 'g1', name: 'Soon', status: 'active', progress: 20, target_date: '2026-10-12', updated_at: '2026-10-06T00:00:00Z' },
    { id: 'g2', name: 'Fine', status: 'active', progress: 50, target_date: '2027-06-01', updated_at: '2026-10-06T00:00:00Z' },
    { id: 'g3', name: 'Paused', status: 'paused', progress: 0 },
  ]
  const tasks = [{ goal_id: 'g2', status: 'todo' }]
  const flags = goalsNeedingAttention(goals, [], tasks, TODAY)
  assert.equal(flags.length, 1)
  assert.equal(flags[0].goal.id, 'g1')
  assert.ok(flags[0].reasons.some((r) => r.startsWith('Deadline in 5 days')))
  assert.ok(flags[0].reasons.includes('No open milestones or linked tasks'))
})

test('behind-schedule detection uses start and target dates', () => {
  const g = [{ id: 'g', status: 'active', progress: 10, start_date: '2026-09-01', target_date: '2026-11-01', updated_at: '2026-10-06T00:00:00Z' }]
  const flags = goalsNeedingAttention(g, [{ goal_id: 'g', is_done: false, position: 0 }], [], TODAY)
  assert.ok(flags[0].reasons.some((r) => r.startsWith('Behind schedule')))
})

test('daily insight never invents data', () => {
  assert.equal(dailyInsight({ tasks: [], events: [], goalFlags: [] }, TODAY), 'Not enough data yet.')
  const text = dailyInsight({
    tasks: [{ status: 'todo', due_date: TODAY }, { status: 'todo', due_date: TODAY }, { status: 'todo', due_date: '2026-10-01' }],
    events: [{ occurrence_date: TODAY }, { occurrence_date: TODAY }],
    goalFlags: [{ reasons: ['Deadline in 3 days, 10% done'] }],
  }, TODAY)
  assert.equal(text, 'You have 2 tasks due today, 1 overdue, 2 scheduled events, 1 goal with a deadline within 14 days.')
})

test('next action for a goal prefers linked tasks, then milestones, then asks for input', () => {
  const goal = { id: 'g' }
  assert.match(nextActionForGoal(goal, [], [{ goal_id: 'g', status: 'todo', title: 'Write copy' }]).text, /Write copy/)
  assert.match(nextActionForGoal(goal, [{ goal_id: 'g', is_done: false, title: 'Website', position: 0 }], []).text, /Website/)
  assert.equal(nextActionForGoal(goal, [], []).type, 'none')
})

test('recommended priority is explainable and ranking respects the user priority', () => {
  const goalsById = { g: { status: 'active', priority: 'high' } }
  const hot = recommendPriority({ due_date: '2026-10-06', importance: 5, goal_id: 'g' }, { today: TODAY, goalsById })
  assert.equal(hot.level, 'urgent')
  assert.ok(hot.reasons.includes('Overdue'))
  const cold = recommendPriority({ due_date: null, importance: 1 }, { today: TODAY })
  assert.equal(cold.level, 'low')
  const ranked = rankTasks([
    { id: 1, status: 'todo', priority: 'low', importance: 3, due_date: null },
    { id: 2, status: 'todo', priority: 'urgent', importance: 3, due_date: null },
    { id: 3, status: 'completed', priority: 'urgent' },
  ], { today: TODAY })
  assert.deepEqual(ranked.map((r) => r.task.id), [2, 1])
})

test('learning recommendation comes from real items', () => {
  assert.equal(recommendNextTopic([]), null)
  const r = recommendNextTopic([{ status: 'learning', progress: 40, topic: 'React' }, { status: 'not_started', topic: 'SQL' }])
  assert.equal(r.item.topic, 'React')
})

test('addDays sanity', () => assert.equal(addDays('2026-10-31', 1), '2026-11-01'))

import { buildNotifications } from '../src/utils/notificationRules.js'

test('notifications are built from real data and deduplicated by key', () => {
  const n = buildNotifications({
    tasks: [{ id: 't1', title: 'Pay rent', status: 'todo', due_date: '2026-10-01' }, { id: 't2', title: 'Done', status: 'completed', due_date: '2026-10-01' }],
    reminders: [{ id: 'r1', title: 'Call bank', is_done: false, remind_date: TODAY, remind_time: '09:00:00' }, { id: 'r2', title: 'Future', is_done: false, remind_date: '2026-12-01' }],
    goals: [{ id: 'g1', name: 'Laptop', status: 'active', progress: 40, target_date: '2026-10-10' }],
    budgets: [{ id: 'b', category: 'food', amount: 100000 }],
    catThis: [{ category: 'food', amount: 95000 }],
    learning: [{ status: 'learning' }],
    sessions: [],
  }, TODAY)
  const keys = n.map((x) => x.dedupe_key)
  assert.ok(keys.includes('overdue:t1:2026-10-01'))
  assert.ok(!keys.some((k) => k.includes('t2')))
  assert.ok(keys.includes(`reminder:r1:${TODAY}`))
  assert.ok(!keys.some((k) => k.includes('r2')))
  assert.ok(keys.includes('budget:food:2026-10-01:90'))
  assert.ok(keys.includes('goal:g1:2026-10-10:7d'))
  assert.ok(keys.includes('learning:2026-10-05'))
  assert.equal(new Set(keys).size, keys.length)
  assert.match(n.find((x) => x.type === 'budget').body, /TSh 95,000 spent of TSh 100,000/)
})

test('nothing is notified when there is no data', () => assert.deepEqual(buildNotifications({}, TODAY), []))

import { buildPlan } from '../src/utils/planner.js'
import { financeObservations } from '../src/utils/review.js'
import { nextRecurringTask } from '../src/utils/tasks.js'

test('planner puts blocks only in free time and never over events', () => {
  const events = [
    { start_time: '09:00', end_time: '10:30', title: 'Meeting' },
    { start_time: '13:00', end_time: '14:00', title: 'Lunch' },
  ]
  const ranked = [1, 2, 3].map((i) => ({ task: { id: i, title: `T${i}` } }))
  const plan = buildPlan({ events, ranked, study: { id: 's', topic: 'React' }, block: 60, buffer: 0 })
  assert.ok(plan.blocks.length >= 3)
  for (const b of plan.blocks) {
    for (const e of plan.fixed) assert.ok(b.end <= e.start || b.start >= e.end, `${b.title} overlaps ${e.title}`)
    assert.ok(b.start >= 480 && b.end <= 1200)
  }
  assert.equal(plan.blocks.find((b) => b.kind === 'study').title, 'Study: React')
})

test('planner starts after "now" for today and reports what did not fit', () => {
  const ranked = [1, 2, 3, 4].map((i) => ({ task: { id: i, title: `T${i}` } }))
  const late = buildPlan({ events: [], ranked, block: 60, buffer: 0, nowMin: 18 * 60 + 5 })
  assert.equal(late.blocks[0].start, 18 * 60 + 15)
  assert.equal(late.blocks.length, 1)
  assert.equal(late.unscheduled.length, 3)
})

test('finance observations state only facts from the numbers', () => {
  assert.deepEqual(financeObservations({}), ['Not enough data yet.'])
  const lines = financeObservations({
    monthly: [{ income: 1000000, expenses: 500000 }, { income: 1500000, expenses: 650000 }],
    catThis: [{ category: 'transport', amount: 200000 }, { category: 'food', amount: 100000 }],
    catPrev: [{ category: 'transport', amount: 150000 }],
    budgets: [{ category: 'food', amount: 110000 }],
  })
  assert.ok(lines.some((l) => l.includes('TSh 650,000') && l.includes("last month's full total was TSh 500,000")))
  assert.ok(lines.some((l) => l.includes('Transport') && l.includes('largest')))
  assert.ok(lines.some((l) => l.includes('Transport spending (TSh 200,000) has already passed')))
  assert.ok(lines.some((l) => l.includes('Food budget is 91% used')))
  assert.ok(!lines.join(' ').match(/[$€£]|USD/))
})

test('completing a repeating task creates the next copy; one-off tasks create none', () => {
  assert.equal(nextRecurringTask({ title: 'x', recurrence: 'none' }, TODAY), null)
  const next = nextRecurringTask({ title: 'Weekly report', recurrence: 'weekly', due_date: '2026-10-07', priority: 'high' }, TODAY)
  assert.equal(next.due_date, '2026-10-14')
  assert.equal(next.status, 'todo')
  assert.equal(next.priority, 'high')
  const stale = nextRecurringTask({ title: 'Daily', recurrence: 'daily', due_date: '2026-10-01' }, TODAY)
  assert.equal(stale.due_date, '2026-10-07')
})
