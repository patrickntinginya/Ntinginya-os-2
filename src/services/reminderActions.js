import { db } from './db'
import { nextOccurrence } from '../utils/date'

/** Same rule as the Reminders screen: a repeating reminder rolls to its next date, a one-off reminder is marked done. */
export async function completeReminderById(id) {
  const [r] = await db.list('reminders', { filters: [{ op: 'eq', column: 'id', value: id }], limit: 1, order: [{ column: 'created_at', ascending: false }] })
  if (!r) throw new Error('This reminder no longer exists.')
  if (r.is_done) return 'already_done'
  if (r.repeat_option && r.repeat_option !== 'none') {
    await db.update('reminders', r.id, { remind_date: nextOccurrence(r.remind_date, r.repeat_option, r.repeat_interval_days) })
    return 'rolled_forward'
  }
  await db.update('reminders', r.id, { is_done: true })
  return 'done'
}
