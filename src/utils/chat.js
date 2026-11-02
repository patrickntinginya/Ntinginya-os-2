// Pure rules for Community live chat (no React, no network): validation, message status, merging, typing, last seen, error text.
// Texts returned from here are English phrases that the screens pass through tr().
export const CHAT = { body: 4000, title: 60, group: 50, media: 52428800, page: 30, search: 60, typingTtl: 4500, typingEvery: 2500, editWindowMs: 24 * 3600 * 1000 }

const IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
const VIDEO = ['video/mp4', 'video/webm', 'video/quicktime']
const AUDIO = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/x-m4a']
const DOCS = ['application/pdf', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
export const CHAT_MIME = [...IMAGE, ...VIDEO, ...AUDIO, ...DOCS] // exactly the bucket's allow-list
// Must match the chk constraint on chat_reports.reason in migration 010.
export const CHAT_REPORT_REASONS = [{ value: 'spam', label: 'Spam' }, { value: 'abuse', label: 'Abuse' }, { value: 'harassment', label: 'Harassment' }, { value: 'inappropriate', label: 'Inappropriate content' }, { value: 'other', label: 'Something else' }]

/** Attachment kind for a picked file: image | video | file. (Recorded voice notes are sent with kind 'voice' by the voice recorder.) */
export const attachmentKind = (mime) => (IMAGE.includes(mime) ? 'image' : VIDEO.includes(mime) ? 'video' : CHAT_MIME.includes(mime) ? 'file' : null)

export const cleanText = (s) => String(s ?? '').replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim()

/** null when fine, otherwise an English phrase. */
export function validateChatMessage({ body, file } = {}) {
  const text = cleanText(body)
  if (!text && !file) return 'Write a message or attach a file.'
  if (text.length > CHAT.body) return 'That message is too long.'
  if (file) {
    if (!attachmentKind(file.type)) return 'That file type is not allowed in chat.'
    if (!(file.size > 0)) return 'That file is empty.'
    if (file.size > CHAT.media) return 'That file is larger than 50 MB.'
  }
  return null
}
export function validateGroup({ title, memberIds }) {
  const t = cleanText(title)
  if (t.length < 1) return 'Give the group a name.'
  if (t.length > CHAT.title) return 'The group name is too long.'
  const n = new Set(memberIds || []).size
  if (n < 1) return 'Choose at least one other member.'
  if (n > CHAT.group - 1) return 'A group can have up to 50 members.'
  return null
}

const safeName = (name) => String(name || 'file').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/\.{2,}/g, '.').replace(/^[-.]+|[-.]+$/g, '').slice(-80) || 'file'
/** <sender>/<conversation>/<id>-<name>: the database policy requires exactly this shape. */
export const chatMediaPath = (userId, conversationId, id, name) => `${userId}/${conversationId}/${id}-${safeName(name)}`

const t = (v) => (v ? Date.parse(v) : NaN)
/** Status of MY message: 'sending' | 'failed' | 'sent' | 'delivered' | 'read' (+ how many read it). Members who joined after the message do not count. */
export function messageStatus(msg, me, members = []) {
  if (msg._pending) return { status: 'sending', readBy: 0, total: 0 }
  if (msg._failed) return { status: 'failed', readBy: 0, total: 0 }
  const created = t(msg.created_at)
  const others = members.filter((m) => m.user_id !== me && !m.left_at && !(t(m.history_from) > created))
  if (!others.length) return { status: 'sent', readBy: 0, total: 0 }
  const read = others.filter((m) => t(m.last_read_at) >= created).length
  const delivered = others.filter((m) => t(m.last_delivered_at) >= created || t(m.last_read_at) >= created).length
  const status = read === others.length ? 'read' : delivered === others.length ? 'delivered' : 'sent'
  return { status, readBy: read, total: others.length }
}

const order = (a, b) => (t(a.created_at) - t(b.created_at)) || String(a.id).localeCompare(String(b.id))
/** Merge fetched/real-time messages into the list: no duplicates, a real row replaces its optimistic copy (same client_id), oldest first. */
export function mergeMessages(list, incoming) {
  const byId = new Map()
  for (const m of list || []) byId.set(m.id, m)
  for (const m of [].concat(incoming || [])) {
    if (m.client_id) for (const [k, v] of byId) if (v._pending && v.client_id === m.client_id && v.sender_id === m.sender_id) byId.delete(k)
    byId.set(m.id, { ...(byId.get(m.id) || {}), ...m, _pending: Boolean(m._pending), _failed: Boolean(m._failed) })
  }
  return [...byId.values()].sort(order)
}
/** An optimistic message shown immediately; replaced by the real row when the server confirms. */
export const optimisticMessage = ({ id, clientId, conversationId, me, body, kind = 'text', file = null, durationMs = null, now = new Date().toISOString() }) => (
  { id, client_id: clientId, conversation_id: conversationId, sender_id: me, kind, body: body || null, media_name: file ? file.name : null, media_mime: file ? file.type : null, media_size: file ? file.size : null, duration_ms: durationMs ? Math.round(durationMs) : null, created_at: now, _pending: true, _progress: 0 })

export function canEdit(msg, me, now = Date.now()) {
  return msg.sender_id === me && msg.kind === 'text' && !msg.deleted_at && !msg._pending && now - t(msg.created_at) < CHAT.editWindowMs
}

/** Who is typing right now. Entries expire by themselves, so a lost "stopped typing" event never leaves the indicator stuck. */
export function createTypingTracker({ ttl = CHAT.typingTtl, now = () => Date.now() } = {}) {
  const until = new Map()
  return {
    heard(userId) { until.set(userId, now() + ttl) },
    stopped(userId) { until.delete(userId) },
    active() { const n = now(); for (const [k, v] of until) if (v <= n) until.delete(k); return [...until.keys()] },
    clear() { until.clear() },
  }
}
export function typingLabel(names) {
  const n = (names || []).filter(Boolean)
  if (!n.length) return ''
  if (n.length === 1) return `${n[0]} is typing…`
  if (n.length === 2) return `${n[0]} and ${n[1]} are typing…`
  return 'Several people are typing…'
}

/** { key, n } so the screen can translate: 'online' | 'minutes' | 'hours' | 'days' | 'long' | 'hidden'. */
export function lastSeenInfo(iso, now = Date.now()) {
  if (!iso) return { key: 'hidden' }
  const s = Math.max(0, Math.round((now - t(iso)) / 1000))
  if (!Number.isFinite(s)) return { key: 'hidden' }
  if (s < 90) return { key: 'online' }
  if (s < 3600) return { key: 'minutes', n: Math.floor(s / 60) }
  if (s < 86400) return { key: 'hours', n: Math.floor(s / 3600) }
  if (s < 7 * 86400) return { key: 'days', n: Math.floor(s / 86400) }
  return { key: 'long' }
}

export const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString()

/** Database / RLS errors -> friendly English phrase (null when unknown). */
export function chatError(e) {
  const m = String(e?.message || e?.error || e || '')
  const map = [
    [/rate_limited/, 'You are sending too quickly. Please wait a moment.'], [/blocked/, 'You cannot message this person.'], [/dm_disabled/, 'This person is not accepting new chats.'],
    [/profile_required/, 'Join the Community first to use chat.'], [/user_unavailable/, 'This member is not available.'], [/not_allowed|row-level security|violates row|42501/, 'You are not allowed to do that here.'],
    [/locked/, 'This conversation has been locked by a moderator.'], [/group_full/, 'The group is full (50 members).'], [/too_old/, 'Messages can only be edited for 24 hours.'],
    [/bad_title/, 'Give the group a name (up to 60 characters).'], [/bad_member_count/, 'Choose between 1 and 49 other members.'], [/own_message/, 'You cannot report your own message.'],
    [/duplicate key|23505/, 'That was already done.'],
  ]
  for (const [re, text] of map) if (re.test(m)) return text
  return null
}
