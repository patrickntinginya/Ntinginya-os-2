import { addInterval } from './date.js'

/** When a repeating task is completed, this is the next copy to create (or null for one-off tasks). */
export function nextRecurringTask(task, today) {
  if (!task.recurrence || task.recurrence === 'none') return null
  const base = task.due_date && task.due_date >= today ? task.due_date : task.due_date || today
  let due = addInterval(base, task.recurrence)
  let guard = 0
  while (due < today && guard++ < 1000) due = addInterval(due, task.recurrence)
  return {
    title: task.title, notes: task.notes, priority: task.priority, category: task.category, importance: task.importance,
    recurrence: task.recurrence, goal_id: task.goal_id, project_id: task.project_id, due_date: due, status: 'todo',
  }
}
