import { db } from './db'
import { nextRecurringTask } from '../utils/tasks'

/** Completes a task and, if it repeats, creates its next copy. */
export async function completeTask(task, today) {
  await db.update('tasks', task.id, { status: 'completed' })
  const next = nextRecurringTask(task, today)
  if (next) await db.create('tasks', next)
}
