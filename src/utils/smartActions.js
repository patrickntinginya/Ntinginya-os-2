// Pure rules of the Smart Action Center. No React, no network: unit-tested in tests/smart-actions.test.js.
import { ID_START, ID_RANGE } from '../lib/reminderSchedule.js'

export const SNOOZE_MINUTES = 5
export const SNOOZE_MS = SNOOZE_MINUTES * 60 * 1000
export const PAGE_SIZE = 25

/** Notification ids for snoozed notifications live ABOVE the reminder range, so rebuilding reminder alarms never cancels them. */
export const SNOOZE_ID_START = ID_START + ID_RANGE // 2,000,000,000
export const SNOOZE_ID_RANGE = 100_000_000 // stays below 2^31 - 1 (valid Android notification ids)

function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
/** Stable id for one notification: scheduling it twice REPLACES the first alarm instead of adding a second. */
export const snoozeAlarmId = (notificationId) => SNOOZE_ID_START + (fnv1a(String(notificationId)) % SNOOZE_ID_RANGE)
export const isSnoozeAlarmId = (id) => Number.isInteger(id) && id >= SNOOZE_ID_START && id < SNOOZE_ID_START + SNOOZE_ID_RANGE

export const CATEGORY_OF_TYPE = {
  reminder: 'reminders', overdue_task: 'tasks', budget: 'finance', goal_deadline: 'goals', learning: 'learning', ai: 'ai',
  habit: 'habits', project: 'projects', briefing: 'briefings', weekly_review: 'briefings', community: 'community',
  appointment: 'professional', payment: 'payments', subscription: 'premium', security: 'security',
}
export const CATEGORIES = [
  { value: 'all', label: 'All categories' },
  { value: 'reminders', label: 'Reminders' },
  { value: 'tasks', label: 'Task deadlines' },
  { value: 'finance', label: 'Financial alerts' },
  { value: 'goals', label: 'Goal reminders' },
  { value: 'habits', label: 'Habit reminders' },
  { value: 'projects', label: 'Project updates' },
  { value: 'ai', label: 'AI recommendations' },
  { value: 'community', label: 'Community' },
  { value: 'professional', label: 'Appointments' },
  { value: 'payments', label: 'Payments' },
  { value: 'premium', label: 'Premium' },
  { value: 'security', label: 'Security' },
]
export const categoryOf = (n) => CATEGORY_OF_TYPE[n?.type] || 'other'
export const typesOfCategory = (category) => Object.entries(CATEGORY_OF_TYPE).filter(([, c]) => c === category).map(([t]) => t)

export const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'read', label: 'Read' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'upcoming', label: 'Upcoming' },
]

const ms = (v) => (v ? new Date(v).getTime() : NaN)
export const isSnoozed = (n, now = Date.now()) => n?.status === 'open' && ms(n.snoozed_until) > now
export const isActionable = (n) => Boolean(n) && n.status === 'open' && Boolean(n.action_kind)
export const isOverdue = (n, now = Date.now()) => n?.status === 'open' && !isSnoozed(n, now) && (n.type === 'overdue_task' || ms(n.due_at) < now)
export const isUpcoming = (n, now = Date.now()) => n?.status === 'open' && ms(n.due_at) >= now

/** Same rules the database query applies, so a locally patched row ends up in the same list as a reloaded one. */
export function matchesFilter(n, filter, now = Date.now()) {
  if (filter === 'unread') return !n.is_read
  if (filter === 'read') return Boolean(n.is_read)
  if (filter === 'overdue') return isOverdue(n, now)
  if (filter === 'upcoming') return isUpcoming(n, now)
  return true
}

/** Marking a task done can create its next repeat, which is awkward to undo, so it is the only action that asks first. */
export const SENSITIVE_KINDS = new Set(['complete_task'])
export const requiresConfirm = (kind) => SENSITIVE_KINDS.has(kind)

/** One idempotency key per notification for DO IT: pressing twice, or on two devices, is the same intent. */
export const doItKey = (notificationId) => `doit:${notificationId}`
export const snoozeKey = (notificationId, nowMs = Date.now()) => `snooze:${notificationId}:${nowMs}`

/** Escapes characters that have meaning inside a PostgREST filter value or an ILIKE pattern. */
export function searchPattern(text) {
  const clean = String(text || '').trim().slice(0, 60).replace(/[%_\\*(),."']/g, ' ').replace(/\s+/g, ' ').trim()
  return clean ? `%${clean}%` : ''
}

/** The Android action buttons and the web notification buttons share these ids. */
export const ACTION_IDS = { doIt: 'do', snooze: 'snooze' }
