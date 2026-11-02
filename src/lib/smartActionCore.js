// Dependency-injected core of DO IT / REMIND ME AFTER 5M / paging. No Supabase import here, so Node tests can drive it with fakes.
import { doItKey, searchPattern, snoozeKey, typesOfCategory } from '../utils/smartActions.js'
import { isUuid } from './uuid.js'

const q = (v) => `"${String(v).replace(/"/g, '')}"` // quote a value inside an or()/and() filter string

/** Applies filter / category / search / cursor to a PostgREST query builder. */
export function applyPageFilters(query, { filter = 'all', category = 'all', search = '', cursor = null, now = new Date() } = {}) {
  const iso = now.toISOString()
  if (filter === 'unread') query = query.eq('is_read', false)
  if (filter === 'read') query = query.eq('is_read', true)
  if (filter === 'overdue') query = query.eq('status', 'open').or(`type.eq.overdue_task,due_at.lt.${q(iso)}`).or(`snoozed_until.is.null,snoozed_until.lte.${q(iso)}`)
  if (filter === 'upcoming') query = query.eq('status', 'open').gte('due_at', iso)
  if (category !== 'all') query = query.in('type', typesOfCategory(category))
  const pattern = searchPattern(search)
  if (pattern) query = query.or(`title.ilike.${q(pattern)},body.ilike.${q(pattern)}`)
  if (cursor) query = query.or(`created_at.lt.${q(cursor.created_at)},and(created_at.eq.${q(cursor.created_at)},id.lt.${q(cursor.id)})`)
  return query
}

/**
 * Runs a notification's action exactly once. The database claims the notification first, so a second tap, a second device or a repeated
 * link cannot run it twice. If the action fails the claim is released (status back to open) so the user can retry.
 */
export async function doItCore(n, { rpc, run, today, onChanged = () => {} }) {
  const key = doItKey(n.id)
  const claim = await rpc('notification_begin_action', { p_notification: n.id, p_key: key })
  if (!claim?.claimed) return { status: 'duplicate', link: n.link || null, summary: claim?.result || claim?.status || null }
  if (!isUuid(claim.claim_id)) throw new Error('The server did not issue a valid claim. Please try again.') // never run an action without a claim to finish
  const kind = claim.action_kind
  const ref = claim.action_ref || {}
  try {
    let summary = 'opened'
    if (kind && kind !== 'open') {
      if (!isUuid(ref.id)) throw new Error('This notification has no valid target.')
      if (!run[kind]) throw new Error('Unknown action.')
      summary = (await run[kind](ref.id, ref, today)) || 'done'
    }
    await rpc('notification_finish_action', { p_notification: n.id, p_key: key, p_claim: claim.claim_id, p_ok: true, p_result: String(summary) })
    onChanged()
    return { status: 'done', link: claim.link || n.link || null, summary: String(summary), kind }
  } catch (e) {
    await rpc('notification_finish_action', { p_notification: n.id, p_key: key, p_claim: claim.claim_id, p_ok: false, p_result: String(e?.message || 'failed').slice(0, 200) }).catch(() => {})
    throw e
  }
}

export async function snoozeCore(n, { rpc, nowMs = Date.now(), onChanged = () => {} }) {
  const res = await rpc('notification_snooze', { p_notification: n.id, p_key: snoozeKey(n.id, nowMs) })
  onChanged()
  return res
}

export async function wakeCore({ rpc, onChanged = () => {} }) {
  const rows = await rpc('notification_wake_due', {})
  if (rows?.length) onChanged()
  return rows || []
}
