import { tr } from '../i18n/index.js'
import { daysBetween } from './date.js'
import { isOpenTask } from './metrics.js'

const USER_WEIGHT = { low: 0, medium: 3, high: 6, urgent: 9 }

/**
 * Rule-based "Recommended" priority from urgency, importance, due date and goal relevance.
 * This is arithmetic, not AI. The user's own priority is never changed by it.
 */
export function recommendPriority(task, { today, goalsById = {} }) {
  const reasons = []
  let urgency = 0
  if (task.due_date) {
    const left = daysBetween(today, task.due_date)
    if (left < 0) { urgency = 5; reasons.push('Overdue') }
    else if (left === 0) { urgency = 4; reasons.push('Due today') }
    else if (left <= 2) { urgency = 3; reasons.push(tr('Due within 2 days')) }
    else if (left <= 7) { urgency = 2; reasons.push(tr('Due this week')) }
    else urgency = 1
  }
  const importance = Math.min(5, Math.max(1, Number(task.importance) || 3))
  if (importance >= 4) reasons.push(`Importance ${importance}/5`)
  const goal = task.goal_id ? goalsById[task.goal_id] : null
  let relevance = 0
  if (goal && goal.status === 'active') {
    relevance = goal.priority === 'high' ? 2 : 1
    reasons.push(goal.priority === 'high' ? tr('Linked to a high-priority goal') : tr('Linked to an active goal'))
  }
  const score = urgency * 3 + importance * 2 + relevance * 2
  const level = score >= 20 ? 'urgent' : score >= 14 ? 'high' : score >= 8 ? 'medium' : 'low'
  return { level, score, reasons }
}

/** Open tasks ordered by recommendation score plus the user's own priority. Top of the list = do first. */
export function rankTasks(tasks, ctx) {
  return tasks
    .filter(isOpenTask)
    .map((t) => {
      const rec = recommendPriority(t, ctx)
      return { task: t, rec, rank: rec.score + (USER_WEIGHT[t.priority] ?? 3) }
    })
    .sort((a, b) => b.rank - a.rank || String(a.task.due_date || '9999').localeCompare(String(b.task.due_date || '9999')))
}
