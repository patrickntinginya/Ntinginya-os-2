import { tr, plural } from '../i18n/index.js'
// Project and goal rollups. Progress is only reported when it can be computed from real records.
import { daysBetween } from './date.js'
import { isOpenTask } from './metrics.js'

/** Share of a project's (non-cancelled) tasks that are completed. Null when the project has no tasks. */
export function projectProgress(project, tasks) {
  const mine = tasks.filter((t) => t.project_id === project.id && t.status !== 'cancelled')
  if (!mine.length) return null
  const done = mine.filter((t) => t.status === 'completed').length
  return { done, total: mine.length, percent: Math.round((done / mine.length) * 100) }
}

/** Milestones belong to goals; a project linked to a goal inherits that goal's milestones. */
export function overdueMilestones(project, milestones, today) {
  if (!project.goal_id) return []
  return milestones.filter((m) => m.goal_id === project.goal_id && !m.is_done && m.due_date && m.due_date < today)
}

export function projectsNeedingAttention(projects, tasks, milestones, today) {
  const out = []
  for (const p of projects.filter((x) => ['planning', 'active'].includes(x.status))) {
    const reasons = []
    const prog = projectProgress(p, tasks)
    if (p.deadline) {
      const left = daysBetween(today, p.deadline)
      if (left < 0) reasons.push(tr('Deadline passed {days} ago', { days: plural(-left, 'day') }))
      else if (left <= 7 && (!prog || prog.percent < 100)) reasons.push(tr('Deadline in {days}{progress}', { days: plural(left, 'day'), progress: prog ? tr(', {percent}% done', { percent: prog.percent }) : '' }))
    }
    const od = overdueMilestones(p, milestones, today)
    if (od.length) reasons.push(plural(od.length, 'overdue milestone'))
    const overdueTasks = tasks.filter((t) => t.project_id === p.id && isOpenTask(t) && t.due_date && t.due_date < today).length
    if (overdueTasks) reasons.push(plural(overdueTasks, 'overdue task'))
    if (p.status === 'active' && !tasks.some((t) => t.project_id === p.id && isOpenTask(t))) reasons.push(tr('No open tasks'))
    if (reasons.length) out.push({ project: p, reasons })
  }
  return out
}

/**
 * Goal progress that rolls up from real records, in this order:
 * milestones (if any) -> linked tasks, including tasks of projects linked to the goal (if any) -> the manual value.
 */
export function rolledUpProgress(goal, { milestones = [], tasks = [], projects = [] }) {
  const ms = milestones.filter((m) => m.goal_id === goal.id)
  if (ms.length) return { percent: Math.round((ms.filter((m) => m.is_done).length / ms.length) * 100), source: 'milestones' }
  const projectIds = new Set(projects.filter((p) => p.goal_id === goal.id).map((p) => p.id))
  const linked = tasks.filter((t) => (t.goal_id === goal.id || projectIds.has(t.project_id)) && t.status !== 'cancelled')
  if (linked.length) return { percent: Math.round((linked.filter((t) => t.status === 'completed').length / linked.length) * 100), source: 'tasks' }
  return { percent: Number(goal.progress) || 0, source: 'manual' }
}
