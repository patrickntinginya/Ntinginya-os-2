import { tr, plural } from '../i18n/index.js'
// Decides which in-app notifications exist right now, from real data only. Pure and testable.
// Each item has a dedupe_key, so the same thing is only notified once even if this runs many times.
import { budgetUsage } from './metrics.js'
import { daysBetween, startOfMonth, startOfWeek } from './date.js'
import { formatMoney } from './format.js'
import { labelOf } from '../lib/constants.js'
import { doneMap, habitSummary } from './habits.js'
import { projectsNeedingAttention } from './projects.js'
import { buildBriefing } from './briefing.js'
import { timeToMinutes } from './date.js'

const cap = (arr, n) => arr.slice(0, n)

export function buildNotifications(input, today, nowMinutes = null) {
  const { tasks = [], reminders = [], goals = [], budgets = [], catThis = [], learning = [], sessions = [], projects = [], milestones = [], habits = [], entries = [] } = input
  const out = []

  for (const t of cap(tasks.filter((x) => ['todo', 'in_progress'].includes(x.status) && x.due_date && x.due_date < today), 20)) {
    out.push({ type: 'overdue_task', title: `Overdue: ${t.title}`, body: tr('This was due {due_date}.', { due_date: t.due_date }), link: '/tasks', dedupe_key: `overdue:${t.id}:${t.due_date}` })
  }

  for (const r of cap(reminders.filter((x) => !x.is_done && x.remind_date <= today), 20)) {
    out.push({ type: 'reminder', title: `Reminder: ${r.title}`, body: `${r.remind_date}${r.remind_time ? ` at ${String(r.remind_time).slice(0, 5)}` : ''}`, link: '/reminders', dedupe_key: `reminder:${r.id}:${r.remind_date}` })
  }

  const month = startOfMonth(today)
  for (const u of budgetUsage(budgets, catThis)) {
    if (u.level === 'ok') continue
    const threshold = u.percent >= 100 ? 100 : u.percent >= 90 ? 90 : 70
    out.push({
      type: 'budget',
      title: tr('{labelOf} budget at {percent}%', { labelOf: labelOf([], u.category), percent: u.percent }),
      body: tr('{formatMoney} spent of {formatMoney2}.', { formatMoney: formatMoney(u.spent), formatMoney2: formatMoney(u.budget) }),
      link: '/finance',
      dedupe_key: `budget:${String(u.category).trim().toLowerCase()}:${month}:${threshold}`,
    })
  }

  for (const g of goals.filter((x) => x.status === 'active' && x.target_date)) {
    const left = daysBetween(today, g.target_date)
    if (left < 0) out.push({ type: 'goal_deadline', title: tr('Goal deadline passed: {name}', { name: g.name }), body: tr('{progress}% done.', { progress: g.progress }), link: '/goals', dedupe_key: `goal:${g.id}:${g.target_date}:late` })
    else if (left <= 7) out.push({ type: 'goal_deadline', title: tr('Goal due in {days}: {name}', { days: plural(left, 'day'), name: g.name }), body: tr('{progress}% done.', { progress: g.progress }), link: '/goals', dedupe_key: `goal:${g.id}:${g.target_date}:7d` })
  }

  const learningNow = learning.filter((l) => l.status === 'learning')
  const weekStart = startOfWeek(today)
  if (learningNow.length && !sessions.some((s) => s.session_date >= weekStart)) {
    out.push({ type: 'learning', title: tr('No study sessions logged this week'), body: tr('You have {topics} in progress.', { topics: plural(learningNow.length, 'topic') }), link: '/knowledge', dedupe_key: `learning:${weekStart}` })
  }

  // ---- V3 ----
  for (const { project, reasons } of cap(projectsNeedingAttention(projects, tasks, milestones, today).filter((x) => x.project.deadline), 10)) {
    out.push({ type: 'project', title: tr('Project needs attention: {name}', { name: project.name }), body: `${reasons[0]}.`, link: '/projects', dedupe_key: `project:${project.id}:${project.deadline}:${reasons[0].slice(0, 12)}` })
  }

  // Habit reminder: due today, not done, and its reminder time has passed (only when the clock time is known).
  if (nowMinutes != null) {
    const map = doneMap(entries)
    for (const h of habits.filter((x) => !x.archived_at && x.reminder_time)) {
      const s = habitSummary(h, map.get(h.id) || new Set(), today)
      if (s.dueToday && !s.doneToday && nowMinutes >= timeToMinutes(h.reminder_time)) {
        out.push({ type: 'habit', title: `Habit: ${h.name}`, body: s.streak ? tr('Keep your {streak}-day streak going.', { streak: s.streak }) : tr('Not done yet today.'), link: '/habits', dedupe_key: `habit:${h.id}:${today}` })
      }
    }
  }

  // Daily briefing (once a day, only if there is something to say) and weekly review (from Sunday).
  const b = buildBriefing(input, today)
  if (b.hasData && (b.counts.tasks || b.counts.events || b.counts.reminders)) {
    const bits = []
    if (b.counts.tasks) bits.push(`${b.counts.tasks} task${b.counts.tasks === 1 ? '' : 's'}`)
    if (b.counts.events) bits.push(`${b.counts.events} event${b.counts.events === 1 ? '' : 's'}`)
    if (b.counts.reminders) bits.push(`${b.counts.reminders} reminder${b.counts.reminders === 1 ? '' : 's'}`)
    out.push({ type: 'briefing', title: tr('Your daily briefing is ready'), body: `Today: ${bits.join(', ')}.`, link: '/today', dedupe_key: `briefing:${today}` })
  }
  const [y, m, d] = today.split('-').map(Number)
  if (new Date(y, m - 1, d).getDay() === 0) {
    out.push({ type: 'weekly_review', title: tr('Your weekly review is ready'), body: tr('See how the week went and plan the next one.'), link: '/reviews/weekly', dedupe_key: `weekly:${startOfWeek(today)}` })
  }

  return out
}
