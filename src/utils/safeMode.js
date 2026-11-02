// Habit Safe Mode: a temporary, smaller version of a habit. Pure helpers; storage is in src/services/safeMode.js.
//  * Entering/leaving Safe Mode never changes habit_entries history.
//  * Doing the smaller version records a normal habit entry for that day (flagged safe_mode = true).
//  * A day with nothing recorded is still a missed day, with or without Safe Mode.
import { addDays } from './date.js'

export const MINI_MAX = 200
export const NOTE_MAX = 500
export const MAX_PLAN_DAYS = 90

export const activePlan = (plans, habitId) => (plans || []).find((p) => p.habit_id === habitId && !p.exited_on) || null

/** 'active' | 'expired' (planned end date passed: offer to exit or extend). */
export const planStatus = (plan, today) => (plan.planned_end && plan.planned_end < today ? 'expired' : 'active')

/** Validates the form. Returns { ok: true, values } or { ok: false, error: <i18n key> }. */
export function validatePlan({ mini_version, planned_end, recovery_note } = {}, today) {
  const mini = String(mini_version ?? '').trim()
  if (!mini) return { ok: false, error: 'safe.err.mini' }
  if (mini.length > MINI_MAX) return { ok: false, error: 'safe.err.long' }
  const note = String(recovery_note ?? '').trim()
  if (note.length > NOTE_MAX) return { ok: false, error: 'safe.err.long' }
  let end = null
  if (planned_end) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(planned_end) || Number.isNaN(new Date(`${planned_end}T00:00:00`).getTime())) return { ok: false, error: 'safe.err.date' }
    if (planned_end < today || planned_end > addDays(today, MAX_PLAN_DAYS)) return { ok: false, error: 'safe.err.date' }
    end = planned_end
  }
  return { ok: true, values: { mini_version: mini, recovery_note: note || null, planned_end: end, started_on: today } }
}

/** Default recovery end: one week. */
export const defaultEnd = (today) => addDays(today, 7)

/** Generic smaller versions. They are suggestions only; the user edits them. Returned as i18n keys. */
export const MINI_SUGGESTIONS = ['safe.sugg.two', 'safe.sugg.start', 'safe.sugg.first', 'safe.sugg.half']

/** The habit_entries row for "I did the smaller version today". */
export const safeEntryRow = (habitId, date) => ({ habit_id: habitId, entry_date: date, safe_mode: true })
