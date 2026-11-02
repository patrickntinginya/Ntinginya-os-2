import { plural, tr } from '../i18n/index.js'
// Daily briefing and rule-based life insights. Everything here works with no AI: plain counting and comparison.
import { dateOfTimestamp, daysBetween } from './date.js'
import { budgetUsage, expandEvents, goalsNeedingAttention, taskStats, recommendNextTopic } from './metrics.js'
import { rankTasks } from './priority.js'
import { doneMap, habitSummary } from './habits.js'
import { projectsNeedingAttention, rolledUpProgress } from './projects.js'
import { financeAlerts } from './financeIntel.js'

const PRIORITY_RANK = { urgent: 4, high: 3, medium: 2, low: 1 }

/** Most important active goal: highest priority, then nearest target date. */
export function focusGoal(goals) {
  const active = goals.filter((g) => g.status === 'active')
  return [...active].sort((a, b) => (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0) || String(a.target_date || '9999').localeCompare(String(b.target_date || '9999')))[0] || null
}

/** Days since anything moved on a goal: a linked task completed, a milestone ticked, or the goal edited. Null if unknown. */
export function daysSinceGoalActivity(goal, { tasks = [], milestones = [], projects = [] }, today) {
  const projectIds = new Set(projects.filter((p) => p.goal_id === goal.id).map((p) => p.id))
  const stamps = [goal.updated_at, goal.created_at]
  for (const t of tasks) if ((t.goal_id === goal.id || projectIds.has(t.project_id)) && t.completed_at) stamps.push(t.completed_at)
  for (const m of milestones) if (m.goal_id === goal.id && m.is_done) stamps.push(m.updated_at)
  const days = stamps.filter(Boolean).map((s) => dateOfTimestamp(s))
  if (!days.length) return null
  return daysBetween(days.sort().pop(), today)
}

/** Short, specific, real observations. Returns [] when there is nothing to say. */
export function lifeInsights(data, today) {
  const { tasks = [], goals = [], milestones = [], projects = [], habits = [], entries = [], budgets = [], catThis = [], catPrev = [], monthly = [] } = data
  const out = []
  const stats = taskStats(tasks, today)
  if (stats.overdue.length) out.push({ tone: 'warn', text: tr('You have {tasks}.', { tasks: plural(stats.overdue.length, 'overdue task') }), to: '/tasks' })

  const now = monthly[monthly.length - 1]
  for (const u of budgetUsage(budgets, catThis).filter((x) => x.percent >= 100)) out.push({ tone: 'warn', text: tr('Your {category} spending is above its monthly budget by TSh {amount}.', { category: u.category, amount: Math.round(u.spent - u.budget).toLocaleString('en-US') }), to: '/finance' })
  if (now && now.income > 0 && now.expenses > now.income) out.push({ tone: 'warn', text: tr('Your spending is above your income this month.'), to: '/finance' })

  const top = focusGoal(goals)
  if (top) {
    const idle = daysSinceGoalActivity(top, { tasks, milestones, projects }, today)
    if (idle != null && idle >= 5) out.push({ tone: 'info', text: tr('You have not worked on your highest-priority goal "{name}" for {idle} days.', { name: top.name, idle }), to: '/goals' })
  }
  for (const f of goalsNeedingAttention(goals, milestones, tasks, today).filter((x) => x.reasons.some((r) => /^Deadline/.test(r))).slice(0, 2)) {
    out.push({ tone: 'info', text: `Goal "${f.goal.name}": ${f.reasons.find((r) => /^Deadline/.test(r)).toLowerCase()}.`, to: '/goals' })
  }
  for (const { project, reasons } of projectsNeedingAttention(projects, tasks, milestones, today).slice(0, 2)) {
    out.push({ tone: 'info', text: `Project "${project.name}": ${reasons[0].toLowerCase()}.`, to: '/projects' })
  }

  const map = doneMap(entries)
  for (const h of habits.filter((x) => !x.archived_at)) {
    const s = habitSummary(h, map.get(h.id) || new Set(), today)
    if (s.dueToday && !s.doneToday && s.streak >= 3) out.push({ tone: 'info', text: tr('Keep your {streak}-day "{name}" streak going: not done yet today.', { streak: s.streak, name: h.name }), to: '/habits' })
  }
  return out
}

/** The morning briefing. Every number comes from the arguments; empty sections say so. */
export function buildBriefing(data, today) {
  const { tasks = [], events = [], reminders = [], goals = [], milestones = [], projects = [], habits = [], entries = [], learning = [], monthly = [], budgets = [], catThis = [], catPrev = [] } = data
  const stats = taskStats(tasks, today)
  const todayEvents = expandEvents(events, today, today)
  const dueReminders = reminders.filter((r) => !r.is_done && r.remind_date <= today)
  const goalsById = Object.fromEntries(goals.map((g) => [g.id, g]))
  const ranked = rankTasks(tasks, { today, goalsById })

  const priorities = ranked.slice(0, 3).map((r) => r.task.title)
  const topic = recommendNextTopic(learning)
  if (topic && priorities.length < 3) priorities.push(`Study: ${topic.item.topic}`)

  const g = focusGoal(goals)
  const goalFocus = g ? { name: g.name, percent: rolledUpProgress(g, { milestones, tasks, projects }).percent } : null

  const map = doneMap(entries)
  const live = habits.filter((h) => !h.archived_at)
  const summaries = live.map((h) => habitSummary(h, map.get(h.id) || new Set(), today))
  const dueHabits = summaries.filter((s) => s.dueToday)
  const best = [...dueHabits].sort((a, b) => b.streak - a.streak)[0]

  const now = monthly[monthly.length - 1] || { income: 0, expenses: 0 }
  const alerts = financeAlerts({ monthIncome: now.income, monthExpenses: now.expenses, budgets, catThis, catPrev, today }).filter((a) => /over|%|exceed|pace|more than/.test(a))

  const counts = {
    tasks: stats.dueToday.length + stats.overdue.length,
    dueToday: stats.dueToday.length,
    overdue: stats.overdue.length,
    events: todayEvents.length,
    reminders: dueReminders.length,
  }
  const hasData = counts.tasks + counts.events + counts.reminders + live.length + goals.length > 0
  return {
    hasData,
    counts,
    priorities,
    goalFocus,
    financeAlert: alerts[0] || null,
    habit: dueHabits.length ? { due: dueHabits.length, done: dueHabits.filter((s) => s.doneToday).length, best: best && best.streak >= 2 ? { name: best.habit.name, streak: best.streak } : null } : null,
    projectsAttention: projectsNeedingAttention(projects, tasks, milestones, today).length,
  }
}

