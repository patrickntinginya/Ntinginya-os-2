import { supabase } from '../lib/supabase'
import { loadSnapshot } from './snapshot'
import { buildNotifications } from '../utils/notificationRules'
import { todayISO } from '../utils/date'

const KEYS = ['tasks', 'events', 'reminders', 'goals', 'milestones', 'projects', 'budgets', 'catThis', 'catPrev', 'monthly', 'learning', 'sessions', 'habits', 'habitEntries']

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
