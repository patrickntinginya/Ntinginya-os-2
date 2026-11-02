import { tr } from '../i18n/index.js'
// Life Score: transparent, computed from real records. Every dimension returns a score (0-100) AND the sentence
// explaining it. A dimension with no underlying data is null ("Not enough data yet") and is left out of the average.
import { addDays, dateOfTimestamp } from './date.js'
import { budgetLevel, budgetUsage, goalsNeedingAttention, isOpenTask, savingsRate, studyDaysInRange } from './metrics.js'
import { doneMap, overallCompletion } from './habits.js'
import { rolledUpProgress } from './projects.js'
import { pct } from './format.js'

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)))
export const DIMENSIONS = ['productivity', 'goals', 'finance', 'learning', 'habits', 'planning']
export const LABELS = { productivity: 'Productivity', goals: 'Goals', finance: 'Finance', learning: 'Learning', habits: 'Habits', planning: 'Planning' }
export const MIN_DIMENSIONS = 2

/** Completion rate of tasks that fell due in the 14 days up to and including `asOf`, judged as of that day. */
export function productivityRate(tasks, asOf) {
  const from = addDays(asOf, -13)
  const due = tasks.filter((t) => t.status !== 'cancelled' && t.due_date && t.due_date >= from && t.due_date <= asOf)
  if (!due.length) return null
  const done = due.filter((t) => t.status === 'completed' && t.completed_at && dateOfTimestamp(t.completed_at) <= asOf).length
  return { due: due.length, done, rate: pct(done, due.length) }
}

function productivity(tasks, today) {
  const rate = productivityRate(tasks, today)
  const open = tasks.filter(isOpenTask)
  if (!rate && !open.length) return null
  const overdue = open.filter((t) => t.due_date && t.due_date < today).length
  const overdueShare = open.length ? overdue / open.length : 0
  const base = rate ? rate.rate : 100
  const score = clamp(base * 0.7 + (1 - overdueShare) * 100 * 0.3)
  return {
    score,
    why: `${rate ? tr('{done} of {due} tasks due in the last 14 days are done (70% of this score). ', { done: rate.done, due: rate.due }) : tr('No tasks fell due in the last 14 days. ')}${tr('{overdue} of {open} open tasks are overdue (30%).', { overdue, open: open.length })}`,
  }
}

function goals({ goals: gs = [], milestones = [], tasks = [], projects = [] }, today) {
  const active = gs.filter((g) => g.status === 'active')
  if (!active.length) return null
  const flagged = goalsNeedingAttention(gs, milestones, tasks, today).length
  const onTrack = pct(active.length - flagged, active.length)
  const avg = Math.round(active.reduce((t, g) => t + rolledUpProgress(g, { milestones, tasks, projects }).percent, 0) / active.length)
  return { score: clamp(onTrack * 0.7 + avg * 0.3), why: tr('{p1} of {length} active goals need no attention (70%). Average progress is {avg}% (30%).', { p1: active.length - flagged, length: active.length, avg }) }
}

function finance({ monthly = [], budgets = [], catThis = [] }) {
  const now = monthly[monthly.length - 1]
  if (!now || (now.income <= 0 && now.expenses <= 0)) return null
  const rate = savingsRate(now.income, now.expenses)
  const usage = budgetUsage(budgets, catThis)
  const parts = []
  let score
  const rateScore = rate == null ? 0 : rate < 0 ? 0 : clamp(rate * 5) // a 20% savings rate scores 100
  if (usage.length) {
    const within = usage.filter((u) => budgetLevel(u.percent) !== 'over').length
    const budgetScore = pct(within, usage.length)
    score = clamp(rateScore * 0.5 + budgetScore * 0.5)
    parts.push(tr('Savings rate {rate} (50%; 20% or more scores full marks).', { rate: rate == null ? tr('unknown (no income)') : `${rate}%` }), tr('{within} of {length} budgets are not over (50%).', { within, length: usage.length }))
  } else {
    score = rateScore
    parts.push(tr('Savings rate {rate} (100% of this score because no budgets are set; 20% or more scores full marks).', { rate: rate == null ? tr('unknown (no income)') : `${rate}%` }))
  }
  return { score, why: parts.join(' ') }
}

function learning({ learning: items = [], sessions = [] }, today) {
  const active = items.filter((l) => l.status === 'learning')
  if (!active.length) return null
  const days = studyDaysInRange(sessions, addDays(today, -6), addDays(today, 1))
  return { score: clamp((Math.min(days, 3) / 3) * 100), why: tr('You studied on {days} of the last 7 days. 3 or more days scores full marks.', { days }) }
}

export function habitsRate({ habits = [], entries = [] }, asOf) {
  const live = habits.filter((h) => !h.archived_at)
  if (!live.length) return null
  return overallCompletion(live, doneMap(entries), addDays(asOf, -6), addDays(asOf, 1), asOf)
}

function habits(data, today) {
  const c = habitsRate(data, today)
  if (!c) return null
  return { score: c.rate, why: tr('{done} of {due} habit days were completed in the last 7 days.', { done: c.done, due: c.due }) }
}

function planning({ tasks = [], goals: gs = [], milestones = [] }) {
  const open = tasks.filter(isOpenTask)
  if (!open.length) return null
  const dated = open.filter((t) => t.due_date).length
  const datedShare = pct(dated, open.length)
  const active = gs.filter((g) => g.status === 'active')
  const actionable = active.filter((g) => tasks.some((t) => t.goal_id === g.id && isOpenTask(t)) || milestones.some((m) => m.goal_id === g.id && !m.is_done)).length
  if (!active.length) return { score: datedShare, why: tr('{dated} of {length} open tasks have a due date (100% of this score; no active goals).', { dated, length: open.length }) }
  const actionShare = pct(actionable, active.length)
  return { score: clamp(datedShare * 0.6 + actionShare * 0.4), why: tr('{dated} of {length} open tasks have a due date (60%). {actionable} of {length2} active goals have an open task or milestone (40%).', { dated, length: open.length, actionable, length2: active.length }) }
}

/** Score for the window ending `asOf`, using ONLY dimensions that can be reconstructed from history. Used for the trend. */
function historicalScore(data, asOf) {
  const parts = []
  const p = productivityRate(data.tasks || [], asOf)
  if (p) parts.push(p.rate)
  const h = habitsRate(data, asOf)
  if (h) parts.push(h.rate)
  const active = (data.learning || []).some((l) => l.status === 'learning')
  if (active) parts.push(clamp((Math.min(studyDaysInRange(data.sessions || [], addDays(asOf, -6), addDays(asOf, 1)), 3) / 3) * 100))
  return parts.length ? { value: Math.round(parts.reduce((a, b) => a + b, 0) / parts.length), n: parts.length } : null
}

export function lifeScore(data, today) {
  const fns = { productivity: () => productivity(data.tasks || [], today), goals: () => goals(data, today), finance: () => finance(data), learning: () => learning(data, today), habits: () => habits(data, today), planning: () => planning(data) }
  const dimensions = {}
  for (const d of DIMENSIONS) dimensions[d] = fns[d]()
  const scored = DIMENSIONS.filter((d) => dimensions[d])
  const overall = scored.length >= MIN_DIMENSIONS ? Math.round(scored.reduce((t, d) => t + dimensions[d].score, 0) / scored.length) : null

  const now = historicalScore(data, today)
  const before = historicalScore(data, addDays(today, -7))
  const trend = now && before && now.n === before.n ? { change: now.value - before.value, basis: tr('task completion, habits and study days') } : null

  return {
    overall,
    dimensions,
    trend,
    explanation: overall == null
      ? tr('Not enough data yet. The Life Score needs real data in at least two areas (tasks, goals, money, learning, habits).')
      : tr('The overall score is the plain average of the {count} areas that have data: {areas}. Areas without data are left out, not counted as zero.', { count: scored.length, areas: scored.map((d) => tr(LABELS[d])).join(', ') }),
  }
}
