// Streak rules (pure functions, no database access). They build on the existing habit helpers so there is ONE definition of
// "due day" and "done day":
//   * A day counts once, however many times it was logged (entries are grouped into a Set of dates, one per day).
//   * Dates are local calendar dates (YYYY-MM-DD) supplied by the caller, so the user's own midnight is used, not UTC.
//   * Current streak = consecutive DUE days completed, counted back from today. If today is due but not done yet the streak
//     is NOT broken until the day ends (same rule as the habits screen).
//   * Best streak = the longest run of consecutive due days ever completed. It is never lowered by a later miss.
//   * A missed due day ends the current run but never erases history. A completion in Safe Mode is a real entry for that
//     day (flagged), so it counts; an empty day in Safe Mode is still a missed day. Nothing is ever marked done for the user.
import { addDays, daysBetween } from './date.js'
import { currentStreak, isDue, longestStreak } from './habits.js'

export const MILESTONES = [3, 7, 14, 30, 60, 100, 180, 365]
const MAX_LOOKBACK = 800

/** Most recent DUE day before today that was not completed, or null. */
export function lastMissedDay(habit, done, today) {
  for (let i = 1; i <= MAX_LOOKBACK; i++) {
    const d = addDays(today, -i)
    if (isDue(habit, d) && !done.has(d)) return d
    // Stop once we pass the habit's start (isDue is false there for every earlier day).
    if (habit.start_date && d < habit.start_date) return null
  }
  return null
}

export const milestoneReached = (n) => [...MILESTONES].reverse().find((m) => n >= m) ?? null
export const nextMilestone = (n) => MILESTONES.find((m) => m > n) ?? null

/**
 * One report for the UI.
 *  current / best   - see rules above
 *  lastMissed       - date of the latest missed due day (or null)
 *  daysSinceMiss    - whole days since lastMissed (or null when nothing was ever missed)
 *  needsRestart     - the last due day before today was missed and today is due but not done yet: "a fresh start is available"
 *  comeback         - the user is on a new run (current >= 1) that began right after a miss
 *  milestone/next   - positive feedback markers
 */
export function streakReport(habit, done, today) {
  const current = currentStreak(habit, done, today)
  const best = Math.max(longestStreak(habit, done, today), current)
  const lastMissed = lastMissedDay(habit, done, today)
  // Was the most recent due day before today a miss?
  let prevDue = null
  for (let i = 1; i <= MAX_LOOKBACK && !prevDue; i++) {
    const d = addDays(today, -i)
    if (isDue(habit, d)) prevDue = d
    else if (habit.start_date && d < habit.start_date) break
  }
  const needsRestart = Boolean(prevDue && !done.has(prevDue) && isDue(habit, today) && !done.has(today))
  const next = nextMilestone(current)
  return {
    current,
    best,
    lastMissed,
    daysSinceMiss: lastMissed ? daysBetween(lastMissed, today) : null,
    needsRestart,
    comeback: current >= 1 && lastMissed !== null,
    milestone: milestoneReached(current),
    next,
    daysToNext: next ? next - current : null,
    isBest: current > 0 && current >= best,
  }
}

/** Number of completed due days in the current run that were logged in Safe Mode (entries carry safe_mode = true). */
export function safeDaysInRun(habit, done, safeDates, today) {
  let d = today
  if (isDue(habit, d) && !done.has(d)) d = addDays(d, -1)
  let n = 0
  for (let i = 0; i < MAX_LOOKBACK; i++, d = addDays(d, -1)) {
    if (!isDue(habit, d)) { if (habit.start_date && d < habit.start_date) break; continue }
    if (!done.has(d)) break
    if (safeDates.has(d)) n++
  }
  return n
}
