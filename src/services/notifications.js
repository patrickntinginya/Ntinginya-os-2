import { supabase } from '../lib/supabase'
import { loadSnapshot } from './snapshot'
import { db } from './db'
import { buildNotifications } from '../utils/notificationRules'
import { todayISO } from '../utils/date'
import { PAGE_SIZE } from '../utils/smartActions'
import { applyPageFilters, doItCore, snoozeCore, wakeCore } from '../lib/smartActionCore'
import { completeTask } from './taskActions'
import { completeReminderById } from './reminderActions'
import { setHabitDone } from './habits'
import { isUuid } from '../lib/uuid'

const KEYS = ['tasks', 'events', 'reminders', 'goals', 'milestones', 'projects', 'budgets', 'catThis', 'catPrev', 'monthly', 'learning', 'sessions', 'habits', 'habitEntries']
const changed = () => typeof window !== 'undefined' && window.dispatchEvent(new Event('life-os:notifications-changed'))

/** Computes current notifications from real data and stores any that are new. Existing ones keep their read state. */
export async function syncNotifications() {
  const today = todayISO()
  const { data } = await loadSnapshot(supabase, KEYS, today)
  const input = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v ?? []]))
  input.entries = input.habitEntries
  const now = new Date()
  const rows = buildNotifications(input, today, now.getHours() * 60 + now.getMinutes())
  if (!rows.length) return 0
  const { error } = await supabase
    .from('notifications')
    .upsert(rows, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
  if (error) throw error
  return rows.length
}

export async function unreadCount() {
  const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('is_read', false)
  if (error) throw error
  return count ?? 0
}

export async function setRead(ids, isRead) {
  const { error } = await supabase.from('notifications').update({ is_read: isRead }).in('id', ids)
  if (error) throw error
}

export async function markAllRead() {
  const { error } = await supabase.from('notifications').update({ is_read: true }).eq('is_read', false)
  if (error) throw error
}

export async function deleteNotification(id) {
  const { error } = await supabase.from('notifications').delete().eq('id', id)
  if (error) throw error
}

// ---------- pagination, filters, counts ----------

/**
 * One page of notifications, newest first. Keyset pagination on (created_at, id): the cursor is the last row of the previous page, so
 * pages stay correct when rows are added or changed, and each request costs the same however long the history is.
 * Returns { rows, nextCursor } (nextCursor is null on the last page).
 */
export async function fetchNotificationPage({ filter = 'all', category = 'all', search = '', cursor = null, pageSize = PAGE_SIZE, now = new Date() } = {}) {
  let query = supabase.from('notifications').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(pageSize + 1)
  query = applyPageFilters(query, { filter, category, search, cursor, now })
  const { data, error } = await query
  if (error) throw error
  const rows = data ?? []
  const more = rows.length > pageSize
  const page = more ? rows.slice(0, pageSize) : rows
  const last = page[page.length - 1]
  return { rows: page, nextCursor: more && last ? { created_at: last.created_at, id: last.id } : null }
}

/** Counts for the tab badges. Four cheap head-only requests. */
export async function notificationCounts(now = new Date()) {
  const head = () => supabase.from('notifications').select('id', { count: 'exact', head: true })
  const [all, unread, overdue, upcoming] = await Promise.all([
    head(),
    applyPageFilters(head(), { filter: 'unread', now }),
    applyPageFilters(head(), { filter: 'overdue', now }),
    applyPageFilters(head(), { filter: 'upcoming', now }),
  ])
  for (const r of [all, unread, overdue, upcoming]) if (r.error) throw r.error
  return { all: all.count ?? 0, unread: unread.count ?? 0, read: (all.count ?? 0) - (unread.count ?? 0), overdue: overdue.count ?? 0, upcoming: upcoming.count ?? 0 }
}

// ---------- DO IT / REMIND ME AFTER 5M (logic in lib/smartActionCore.js, tested with fakes) ----------
const rpcDefault = (name, args) => db.rpc(name, args)

/** Runs a notification's action exactly once. Returns { status: 'done' | 'duplicate', link, summary, kind }. */
export function runDoIt(n, { today = todayISO(), rpc = rpcDefault, exec = {} } = {}) {
  const run = { complete_reminder: (id) => completeReminderById(id), complete_task: (id, ref, t) => completeTaskById(id, t), log_habit: (id, ref, t) => setHabitDone(id, ref.date || t, true), ...exec }
  return doItCore(n, { rpc, run, today, onChanged: changed })
}

async function completeTaskById(id, today) {
  const [task] = await db.list('tasks', { filters: [{ op: 'eq', column: 'id', value: id }], limit: 1, order: [{ column: 'created_at', ascending: false }] })
  if (!task) throw new Error('This task no longer exists.')
  if (task.status === 'completed') return 'already_done'
  await completeTask(task, today)
  return 'done'
}

/** Server-timed five-minute snooze. Returns { snoozed, duplicate, snoozed_until } and never stacks a second reminder. */
export const snoozeNotification = (n, { rpc = rpcDefault, nowMs = Date.now() } = {}) => snoozeCore(n, { rpc, nowMs, onChanged: changed })

/** Brings back snoozed notifications whose five minutes are over. Returns the rows (empty most of the time). */
export const wakeDueNotifications = ({ rpc = rpcDefault } = {}) => wakeCore({ rpc, onChanged: changed })

/** Notifications still snoozed in the future: used after a restart to put their alarms back. */
export async function pendingSnoozes(now = new Date()) {
  const { data, error } = await supabase.from('notifications').select('id,title,body,link,snoozed_until,action_kind').eq('status', 'open').gt('snoozed_until', now.toISOString()).limit(100)
  if (error) throw error
  return data ?? []
}

/** Finds the newest open notification for a reminder (used when an Android reminder alarm's buttons are pressed). */
export async function findOpenNotificationForReminder(reminderId) {
  if (!isUuid(reminderId)) return null
  const { data, error } = await supabase.from('notifications').select('*').like('dedupe_key', `reminder:${reminderId}:%`).eq('status', 'open').order('created_at', { ascending: false }).limit(1)
  if (error) throw error
  return data?.[0] ?? null
}
