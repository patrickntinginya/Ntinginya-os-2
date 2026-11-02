import { plural, tr } from '../i18n/index.js'
// Pure functions that turn real rows into numbers and findings. Used by the pages AND by the server-side AI context,
// so what you see on screen and what the assistant is told always come from the same calculation.
import {
  addDays, addMonths, dateOfTimestamp, daysBetween,
  startOfMonth, startOfNextMonth, startOfPrevMonth, startOfWeek, timeToMinutes,
} from './date.js'
import { pct, sum } from './format.js'

const norm = (s) => String(s ?? '').trim().toLowerCase()
const OPEN = ['todo', 'in_progress']

// ---------- tasks ----------
export const isOpenTask = (t) => OPEN.includes(t.status)

export function taskStats(tasks, today) {
  const open = tasks.filter(isOpenTask)
  const weekStart = startOfWeek(today)
  const weekEnd = addDays(weekStart, 7)
  const completedWeek = tasks.filter(
    (t) => t.status === 'completed' && t.completed_at && dateOfTimestamp(t.completed_at) >= weekStart && dateOfTimestamp(t.completed_at) < weekEnd,
  )
  const dueThisWeek = tasks.filter((t) => t.status !== 'cancelled' && t.due_date && t.due_date >= weekStart && t.due_date < weekEnd)
  const dueThisWeekDone = dueThisWeek.filter((t) => t.status === 'completed').length
  return {
    open: open.length,
    overdue: open.filter((t) => t.due_date && t.due_date < today),
    dueToday: open.filter((t) => t.due_date === today),
    completedThisWeek: completedWeek.length,
    // Of the tasks that were due this week, how many are done. null = nothing was due, so no rate to report.
    weekCompletionRate: dueThisWeek.length ? pct(dueThisWeekDone, dueThisWeek.length) : null,
    dueThisWeekCount: dueThisWeek.length,
  }
}

/** Completed tasks per week for the last n weeks (oldest first). */
export function completedPerWeek(tasks, today, n = 8) {
  const start = startOfWeek(today)
  const weeks = Array.from({ length: n }, (_, i) => addDays(start, -7 * (n - 1 - i)))
  return weeks.map((w) => ({
    week: w,
    count: tasks.filter((t) => t.status === 'completed' && t.completed_at && dateOfTimestamp(t.completed_at) >= w && dateOfTimestamp(t.completed_at) < addDays(w, 7)).length,
  }))
}

// ---------- schedule ----------
/** Expand repeating events into dated occurrences between from and to (inclusive). */
export function expandEvents(events, from, to) {
  const out = []
  for (const e of events) {
    const repeat = e.repeat_option || 'none'
    const until = e.repeat_until && e.repeat_until < to ? e.repeat_until : to
    if (repeat === 'none') {
      if (e.event_date >= from && e.event_date <= to) out.push({ ...e, occurrence_date: e.event_date })
      continue
    }
    for (let i = 0; i < 800; i++) {
      const d = repeat === 'monthly' ? addMonths(e.event_date, i) : addDays(e.event_date, i * (repeat === 'weekly' ? 7 : 1))
      if (d > until) break
      if (d >= from) out.push({ ...e, occurrence_date: d })
    }
  }
  return out.sort((a, b) => a.occurrence_date.localeCompare(b.occurrence_date) || String(a.start_time).localeCompare(String(b.start_time)))
}

/** Pairs of events on the same day whose times overlap. Events with no end time are treated as 60 minutes. */
export function findConflicts(occurrences) {
  const byDay = {}
  for (const o of occurrences) (byDay[o.occurrence_date] ||= []).push(o)
  const pairs = []
  for (const day of Object.values(byDay)) {
    const sorted = [...day].sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time))
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const aEnd = sorted[i].end_time ? timeToMinutes(sorted[i].end_time) : timeToMinutes(sorted[i].start_time) + 60
        if (timeToMinutes(sorted[j].start_time) < aEnd) pairs.push([sorted[i], sorted[j]])
      }
    }
  }
  return pairs
}

// ---------- finance ----------
export function monthBounds(today) {
  return { from: startOfMonth(today), to: startOfNextMonth(today), prevFrom: startOfPrevMonth(today) }
}

export const inRange = (rows, from, to, key = 'entry_date') => rows.filter((r) => r[key] >= from && r[key] < to)

export function totalsByCategory(rows) {
  const map = new Map()
  for (const r of rows) {
    const k = norm(r.category) || 'other'
    map.set(k, (map.get(k) || 0) + (Number(r.amount) || 0))
  }
  return [...map.entries()].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total)
}

export const savingsRate = (income, expenses) => (income > 0 ? Math.round(((income - expenses) / income) * 100) : null)

/** level: ok (<70%), warning (70-89), critical (90-99), over (100+). */
export function budgetLevel(percent) {
  if (percent >= 100) return 'over'
  if (percent >= 90) return 'critical'
  if (percent >= 70) return 'warning'
  return 'ok'
}

export function budgetUsage(budgets, monthExpenseRows) {
  const spentBy = new Map(totalsByCategory(monthExpenseRows).map((c) => [c.category, c.total]))
  return budgets
    .map((b) => {
      const budget = Number(b.amount) || 0
      const spent = spentBy.get(norm(b.category)) || 0
      const percent = budget > 0 ? Math.round((spent / budget) * 100) : 0
      return { id: b.id, category: b.category, budget, spent, remaining: budget - spent, percent, level: budgetLevel(percent) }
    })
    .sort((a, b) => b.percent - a.percent)
}

export function savingsPlan(goal, today) {
  const target = Number(goal.target_amount) || 0
  const remaining = Math.max(0, target - (Number(goal.current_amount) || 0))
  if (remaining === 0) return { remaining, done: true }
  if (!goal.target_date) return { remaining, noDate: true }
  const daysLeft = daysBetween(today, goal.target_date)
  if (daysLeft <= 0) return { remaining, passed: true }
  const weeksLeft = Math.max(1, Math.ceil(daysLeft / 7))
  const monthsLeft = Math.max(1, daysLeft / 30.4375)
  return { remaining, daysLeft, weekly: Math.ceil(remaining / weeksLeft), monthly: Math.ceil(remaining / monthsLeft) }
}

// ---------- goals ----------
export function goalMilestoneCounts(goalId, milestones) {
  const mine = milestones.filter((m) => m.goal_id === goalId)
  return { total: mine.length, done: mine.filter((m) => m.is_done).length }
}

/** Real reasons a goal needs attention. Empty list = nothing to flag. */
export function goalsNeedingAttention(goals, milestones, tasks, today) {
  const out = []
  for (const g of goals.filter((x) => x.status === 'active')) {
    const reasons = []
    if (g.target_date) {
      const left = daysBetween(today, g.target_date)
      if (left < 0) reasons.push(tr('Deadline passed {days} ago at {progress}% done', { days: plural(-left, 'day'), progress: g.progress }))
      else if (left <= 14 && g.progress < 100) reasons.push(tr('Deadline in {days}, {progress}% done', { days: plural(left, 'day'), progress: g.progress }))
      if (g.start_date && left >= 0) {
        const total = daysBetween(g.start_date, g.target_date)
        const elapsed = daysBetween(g.start_date, today)
        if (total > 0 && elapsed > 0) {
          const expected = Math.min(100, Math.round((elapsed / total) * 100))
          if (g.progress < expected - 15) reasons.push(tr('Behind schedule: {progress}% done with {expected}% of the time used', { progress: g.progress, expected }))
        }
      }
    }
    const openMilestones = milestones.filter((m) => m.goal_id === g.id && !m.is_done).length
    const openTasks = tasks.filter((t) => t.goal_id === g.id && isOpenTask(t)).length
    if (openMilestones === 0 && openTasks === 0) reasons.push(tr('No open milestones or linked tasks'))
    if (g.updated_at && daysBetween(dateOfTimestamp(g.updated_at), today) >= 14) reasons.push(tr('Not updated for 14 days or more'))
    if (reasons.length) out.push({ goal: g, reasons })
  }
  return out
}

export function nextActionForGoal(goal, milestones, tasks) {
  const ms = milestones.filter((m) => m.goal_id === goal.id && !m.is_done).sort((a, b) => a.position - b.position)
  const linked = tasks.filter((t) => t.goal_id === goal.id && isOpenTask(t)).sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')))
  if (linked[0]) return { type: 'task', text: `Do: ${linked[0].title}` }
  if (ms[0]) return { type: 'milestone', text: tr('Work toward milestone: {title}', { title: ms[0].title }) }
  return { type: 'none', text: tr('Add a milestone or a task to move this goal forward.') }
}

// ---------- learning ----------
export function studyMinutes(sessions, from, to) {
  return sum(sessions.filter((s) => s.session_date >= from && s.session_date < to), 'minutes')
}

export function studyDaysInRange(sessions, from, to) {
  return new Set(sessions.filter((s) => s.session_date >= from && s.session_date < to).map((s) => s.session_date)).size
}

export function minutesPerWeek(sessions, today, n = 8) {
  const start = startOfWeek(today)
  return Array.from({ length: n }, (_, i) => {
    const w = addDays(start, -7 * (n - 1 - i))
    return { week: w, minutes: studyMinutes(sessions, w, addDays(w, 7)) }
  })
}

export function recommendNextTopic(items) {
  const inProgress = items.filter((i) => i.status === 'learning').sort((a, b) => b.progress - a.progress)
  if (inProgress[0]) return { item: inProgress[0], why: tr('Already {progress}% done - keep going', { progress: inProgress[0].progress }) }
  const notStarted = items.filter((i) => i.status === 'not_started').sort((a, b) => String(a.target_date || '9999').localeCompare(String(b.target_date || '9999')))
  if (notStarted[0]) return { item: notStarted[0], why: notStarted[0].target_date ? tr('Nearest target date among topics not started') : tr('Not started yet') }
  return null
}

// ---------- daily insight (plain counting, no model involved) ----------

export function dailyInsight({ tasks, events, goalFlags }, today) {
  const stats = taskStats(tasks, today)
  const todayEvents = events.filter((e) => e.occurrence_date === today)
  const parts = []
  if (stats.dueToday.length) parts.push(tr('{tasks} due today', { tasks: plural(stats.dueToday.length, 'task') }))
  if (stats.overdue.length) parts.push(`${stats.overdue.length} overdue`)
  if (todayEvents.length) parts.push(plural(todayEvents.length, 'scheduled event'))
  const closeGoals = goalFlags.filter((f) => f.reasons.some((r) => /^Deadline/.test(r)))
  if (closeGoals.length) parts.push(tr('{goals} with a deadline within 14 days', { goals: plural(closeGoals.length, 'goal') }))
  if (!parts.length) return tr('Not enough data yet.')
  return tr('You have {parts}.', { parts: parts.join(', ') })
}
