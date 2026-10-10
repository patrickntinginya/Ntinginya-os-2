// Builds the "what the assistant can see" object from the signed-in user's real data.
// The client passed in is scoped to the user's token, so Row Level Security limits every query to that user.
import { loadSnapshot } from '../../../src/services/snapshot.js'
import {
  budgetUsage, expandEvents, findConflicts, goalMilestoneCounts, goalsNeedingAttention, inRange, isOpenTask,
  nextActionForGoal, savingsPlan, savingsRate, studyMinutes, taskStats, totalsByCategory,
} from '../../../src/utils/metrics.js'
import { addDays, startOfWeek } from '../../../src/utils/date.js'
import { sum } from '../../../src/utils/format.js'
import { doneMap, habitSummary } from '../../../src/utils/habits.js'
import { projectProgress } from '../../../src/utils/projects.js'

const KEYS = ['habits', 'habitEntries', 'tasks', 'goals', 'milestones', 'events', 'reminders', 'learning', 'sessions', 'projects', 'ideas', 'budgets',
  'savingsGoals', 'totals', 'monthly', 'catThis', 'catPrev', 'weekIncome', 'weekExpenses']

const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k] ?? null]))

export async function buildContext(client, { today, mode, entityId }) {
  const { data: d, errors } = await loadSnapshot(client, KEYS, today)
  const tasks = d.tasks || []
  const goals = d.goals || []
  const milestones = d.milestones || []
  const events = d.events || []
  const weekStart = startOfWeek(today)
  const monthly = d.monthly || []
  const now = monthly[monthly.length - 1]
  const prev = monthly[monthly.length - 2]
  const stats = taskStats(tasks, today)
  const occ = expandEvents(events, today, addDays(today, 7))

  const ctx = {
    today,
    currency: 'TZS (write as TSh)',
    tasks: {
      open_count: stats.open, overdue_count: stats.overdue.length, due_today_count: stats.dueToday.length,
      completed_this_week: stats.completedThisWeek, week_completion_rate_percent: stats.weekCompletionRate,
      open: tasks.filter(isOpenTask).slice(0, 40).map((t) => pick(t, ['id', 'title', 'priority', 'status', 'due_date', 'goal_id', 'project_id', 'category', 'importance'])),
    },
    schedule_next_7_days: occ.slice(0, 40).map((e) => ({ title: e.title, date: e.occurrence_date, start: String(e.start_time).slice(0, 5), end: e.end_time ? String(e.end_time).slice(0, 5) : null, location: e.location })),
    schedule_conflicts: findConflicts(occ).map(([a, b]) => `${a.occurrence_date}: "${a.title}" overlaps "${b.title}"`),
    reminders_next_14_days: (d.reminders || []).filter((r) => !r.is_done && r.remind_date <= addDays(today, 14)).slice(0, 30)
      .map((r) => ({ id: r.id, title: r.title, date: r.remind_date, time: r.remind_time ? String(r.remind_time).slice(0, 5) : null, priority: r.priority })),
    goals_active: goals.filter((g) => g.status === 'active').slice(0, 30).map((g) => ({
      id: g.id, name: g.name, progress_percent: g.progress, priority: g.priority, start_date: g.start_date, target_date: g.target_date,
      milestones: goalMilestoneCounts(g.id, milestones), next_action: nextActionForGoal(g, milestones, tasks).text,
    })),
    goals_needing_attention: goalsNeedingAttention(goals, milestones, tasks, today).map((f) => ({ goal: f.goal.name, reasons: f.reasons })),
    projects: (d.projects || []).filter((p) => p.status !== 'archived').slice(0, 30).map((p) => ({ ...pick(p, ['id', 'name', 'status', 'deadline', 'goal_id']), task_progress: projectProgress(p, tasks) })),
    // Controlled summary: counts and streaks only, never the free-text notes of a habit.
    habits: (d.habits || []).filter((h) => !h.archived_at).slice(0, 20).map((h) => {
      const s = habitSummary(h, doneMap(d.habitEntries || []).get(h.id) || new Set(), today)
      return { name: h.name, due_today: s.dueToday, done_today: s.doneToday, current_streak: s.streak, longest_streak: s.longest, last_7_days: s.last7 }
    }),
    ideas_recent: (d.ideas || []).slice(0, 10).map((i) => pick(i, ['id', 'title', 'status'])),
    learning: {
      items: (d.learning || []).slice(0, 30).map((l) => pick(l, ['id', 'topic', 'status', 'progress', 'target_date'])),
      study_minutes_this_week: studyMinutes(d.sessions || [], weekStart, addDays(weekStart, 7)),
    },
    finance: {
      all_time_balance: d.totals ? d.totals.income - d.totals.expenses : null,
      this_month: now ? { income: now.income, expenses: now.expenses, savings: now.income - now.expenses, savings_rate_percent: savingsRate(now.income, now.expenses) } : null,
      last_month: prev ? { income: prev.income, expenses: prev.expenses, savings: prev.income - prev.expenses, savings_rate_percent: savingsRate(prev.income, prev.expenses) } : null,
      expenses_by_category_this_month: totalsByCategory(d.catThis || []).slice(0, 10),
      expenses_by_category_last_month: totalsByCategory(d.catPrev || []).slice(0, 10),
      budgets_this_month: budgetUsage(d.budgets || [], d.catThis || []).map((u) => ({ category: u.category, budget: u.budget, spent: u.spent, remaining: u.remaining, percent_used: u.percent })),
      savings_goals: (d.savingsGoals || []).filter((g) => g.status === 'active').slice(0, 20).map((g) => ({
        name: g.name, target: Number(g.target_amount), saved: Number(g.current_amount), target_date: g.target_date, plan: savingsPlan(g, today),
      })),
      last_6_months: monthly,
      this_week: {
        income: sum(inRange(d.weekIncome || [], weekStart, addDays(weekStart, 7))), expenses: sum(inRange(d.weekExpenses || [], weekStart, addDays(weekStart, 7))),
        top_expense_categories: totalsByCategory(d.weekExpenses || []).slice(0, 5),
      },
    },
  }

  const failed = Object.keys(errors)
  let focus = ''
  try {
    if (mode === 'idea_validation' && entityId) {
      const { data } = await client.from('ideas').select('title,description,category,problem,proposed_solution,target_users,business_opportunity,notes,next_action,status').eq('id', entityId).maybeSingle()
      if (data) focus = `<focus_idea>${JSON.stringify(data)}</focus_idea>`
    }
    if (mode === 'goal_coach' && entityId) {
      const goal = goals.find((g) => g.id === entityId)
      if (goal) focus = `<focus_goal>${JSON.stringify({ id: goal.id, name: goal.name, description: goal.description, target_date: goal.target_date, progress_percent: goal.progress, existing_milestones: milestones.filter((m) => m.goal_id === goal.id).map((m) => m.title) })}</focus_goal>`
    }
  } catch {
    failed.push('focus')
  }

  let json = JSON.stringify(ctx)
  if (json.length > 30000) {
    ctx.tasks.open = ctx.tasks.open.slice(0, 15)
    ctx.schedule_next_7_days = ctx.schedule_next_7_days.slice(0, 15)
    json = JSON.stringify(ctx)
  }
  return { block: `<user_data>${json}</user_data>\n<data_gaps>${failed.join(', ') || 'none'}</data_gaps>\n${focus}`, failed }
}
