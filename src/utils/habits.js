import { tr } from '../i18n/index.js'
// Habit logic: due days, streaks, completion rates. Pure functions, no database access.
import { addDays, dateOfTimestamp, parseISO, startOfMonth, startOfNextMonth, startOfWeek } from './date.js'

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MAX_DAYS = 800

const weekday = (iso) => parseISO(iso).getDay()
const startOf = (h) => h.start_date || (h.created_at ? dateOfTimestamp(h.created_at) : '0000-01-01')
const archivedOn = (h) => (h.archived_at ? dateOfTimestamp(h.archived_at) : null)

/** Group entry rows into a Map(habit_id -> Set of dates). */
export function doneMap(entries) {
  const m = new Map()
  for (const e of entries || []) {
    if (!m.has(e.habit_id)) m.set(e.habit_id, new Set())
    m.get(e.habit_id).add(String(e.entry_date).slice(0, 10))
  }
  return m
}

/** Is the habit expected on this date? (started, not archived yet, and on one of its weekdays) */
export function isDue(habit, date) {
  if (date < startOf(habit)) return false
  const arch = archivedOn(habit)
  if (arch && date >= arch) return false
  return (habit.days_of_week?.length ? habit.days_of_week : ALL_DAYS).includes(weekday(date))
}

/**
 * Current streak = consecutive DUE days completed, counting back from today.
 * If today is due but not done yet, the streak is not broken until the day ends.
 */
export function currentStreak(habit, done, today) {
  let d = today
  if (isDue(habit, d) && !done.has(d)) d = addDays(d, -1)
  let count = 0
  for (let i = 0; i < MAX_DAYS && d >= startOf(habit); i++, d = addDays(d, -1)) {
    if (!isDue(habit, d)) continue
    if (done.has(d)) count++
    else break
  }
  return count
}

export function longestStreak(habit, done, today) {
  let best = 0
  let run = 0
  let d = startOf(habit)
  for (let i = 0; i < MAX_DAYS && d <= today; i++, d = addDays(d, 1)) {
    if (!isDue(habit, d)) continue
    if (done.has(d)) {
      run++
      best = Math.max(best, run)
    } else if (d < today) run = 0
  }
  return best
}

/** Share of due days completed in [from, toExclusive), never counting days after today. Null when no day was due. */
export function completion(habit, done, from, toExclusive, today) {
  const end = toExclusive > addDays(today, 1) ? addDays(today, 1) : toExclusive
  let due = 0
  let hit = 0
  for (let d = from < startOf(habit) ? startOf(habit) : from; d < end; d = addDays(d, 1)) {
    if (!isDue(habit, d)) continue
    due++
    if (done.has(d)) hit++
  }
  return due === 0 ? null : { due, done: hit, rate: Math.round((hit / due) * 100) }
}

export function habitSummary(habit, entries, today) {
  const done = entries instanceof Set ? entries : (doneMap(entries.map((e) => ({ ...e, habit_id: habit.id }))).get(habit.id) || new Set())
  return {
    habit,
    dueToday: isDue(habit, today),
    doneToday: done.has(today),
    streak: currentStreak(habit, done, today),
    longest: longestStreak(habit, done, today),
    week: completion(habit, done, startOfWeek(today), addDays(startOfWeek(today), 7), today),
    month: completion(habit, done, startOfMonth(today), startOfNextMonth(today), today),
    last7: completion(habit, done, addDays(today, -6), addDays(today, 1), today),
    done,
  }
}

/** Plain-language observations from real history only. */
export function habitInsights(summary, today) {
  const { habit, done } = summary
  const out = []
  if (summary.streak >= 3) out.push(tr('{streak}-day streak{note}.', { streak: summary.streak, note: summary.longest > summary.streak ? tr(' (your longest is {longest})', { longest: summary.longest }) : tr(' - your longest so far') }))
  if (summary.week) out.push(tr('{done} of {due} due days done this week.', { done: summary.week.done, due: summary.week.due }))
  const missed = new Array(7).fill(0)
  const dueCount = new Array(7).fill(0)
  for (let i = 1; i <= 28; i++) {
    const d = addDays(today, -i)
    if (!isDue(habit, d)) continue
    dueCount[weekday(d)]++
    if (!done.has(d)) missed[weekday(d)]++
  }
  let worst = -1
  for (let w = 0; w < 7; w++) if (missed[w] >= 3 && (worst < 0 || missed[w] > missed[worst])) worst = w
  if (worst >= 0) out.push(tr('You missed it on {p1} of the last {p2} times it was due on {p3}.', { p1: missed[worst], p2: dueCount[worst], p3: tr(WEEKDAY_NAMES[worst]) }))
  if (!out.length) out.push(tr('Not enough history yet to see a pattern.'))
  return out
}

/** Combined completion across all given habits for a date window. */
export function overallCompletion(habits, map, from, toExclusive, today) {
  let due = 0
  let hit = 0
  for (const h of habits) {
    const c = completion(h, map.get(h.id) || new Set(), from, toExclusive, today)
    if (c) {
      due += c.due
      hit += c.done
    }
  }
  return due === 0 ? null : { due, done: hit, rate: Math.round((hit / due) * 100) }
}
