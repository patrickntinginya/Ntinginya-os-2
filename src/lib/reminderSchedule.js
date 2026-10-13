// Pure planning of Android local notifications for reminders. No Capacitor, no clock access except what is passed in.
//
// Rules (documented in docs/ANDROID_BUILD.md):
//  - Times are the device's LOCAL wall-clock date and time.
//  - A reminder without a time fires at DEFAULT_TIME (09:00 local).
//  - Only reminders that are not done are scheduled. Past times are skipped, never fired late.
//  - Repeating reminders are expanded into individual one-shot alarms using the SAME rule as the app (addInterval:
//    daily, weekly, monthly with month-end clamping, custom every N days), starting from the stored remind_date.
//  - A rolling window keeps the number of alarms bounded: HORIZON_DAYS ahead, MAX_PER_REMINDER per reminder, MAX_TOTAL overall.
//    The window is refreshed whenever the app starts, resumes, or reminders change.
import { addInterval } from '../utils/date.js'

export const DEFAULT_TIME = '09:00'
export const HORIZON_DAYS = 30
export const MAX_PER_REMINDER = 14
export const MAX_TOTAL = 64
export const SLOTS = 16 // reserved notification ids per reminder (>= MAX_PER_REMINDER)
export const ID_START = 1_000_000_000
export const ID_RANGE = 1_000_000_000 // ids stay below 2,000,000,000 < 2^31 - 1, valid for Android
const GROUPS = Math.floor(ID_RANGE / SLOTS)
const MIN_LEAD_MS = 5000

/** Is this notification id one of ours (a reminder alarm)? Other future notification kinds must use other ranges. */
export const isReminderNotificationId = (id) => Number.isInteger(id) && id >= ID_START && id < ID_START + GROUPS * SLOTS

function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Stable id for (reminder, occurrence slot). Same input always gives the same id, so rescheduling replaces instead of duplicating. */
export const notificationId = (reminderId, slot = 0, probe = 0) => ID_START + ((fnv1a(String(reminderId)) + probe) % GROUPS) * SLOTS + slot

/** Local Date for 'YYYY-MM-DD' + 'HH:MM[:SS]'. Returns null for malformed input. */
export function localDateTime(isoDate, time = DEFAULT_TIME) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''))
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(time || DEFAULT_TIME))
  if (!d || !t) return null
  const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])]
  const [h, mi] = [Number(t[1]), Number(t[2])]
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return null
  const out = new Date(y, mo - 1, da, h, mi, 0, 0)
  return Number.isNaN(out.getTime()) || out.getMonth() !== mo - 1 ? null : out
}

/** Upcoming alarm times (Date[]) for one reminder inside the window. */
export function occurrencesFor(reminder, now, { horizonDays = HORIZON_DAYS, perReminder = MAX_PER_REMINDER } = {}) {
  if (!reminder || reminder.is_done) return []
  const time = reminder.remind_time || DEFAULT_TIME
  const limit = new Date(now.getTime() + horizonDays * 86400000)
  const repeat = reminder.repeat_option && reminder.repeat_option !== 'none' ? reminder.repeat_option : null
  const out = []
  let date = reminder.remind_date
  for (let guard = 0; guard < 4000 && out.length < perReminder; guard++) {
    const at = localDateTime(date, time)
    if (!at || at > limit) break
    if (at.getTime() >= now.getTime() + MIN_LEAD_MS) out.push(at)
    if (!repeat) break
    const next = addInterval(date, repeat, reminder.repeat_interval_days)
    if (next === date) break
    date = next
  }
  return out
}

/**
 * Full desired schedule: [{ id, at, reminderId, slot }] sorted by time, at most MAX_TOTAL, ids unique.
 * Two different reminders that hash to the same id group are separated deterministically (probe by sorted reminder id).
 */
export function planSchedule(reminders, now, opts = {}) {
  const maxTotal = opts.maxTotal ?? MAX_TOTAL
  const sorted = [...(reminders || [])].filter((r) => r && r.id).sort((a, b) => (a.id < b.id ? -1 : 1))
  const groupOwner = new Map()
  const entries = []
  for (const r of sorted) {
    const times = occurrencesFor(r, now, opts)
    if (!times.length) continue
    let probe = 0
    while (groupOwner.has(notificationId(r.id, 0, probe)) && groupOwner.get(notificationId(r.id, 0, probe)) !== r.id) probe++
    groupOwner.set(notificationId(r.id, 0, probe), r.id)
    times.forEach((at, slot) => entries.push({ id: notificationId(r.id, slot, probe), at, reminderId: r.id, slot }))
  }
  return entries.sort((a, b) => a.at - b.at || a.id - b.id).slice(0, maxTotal)
}
