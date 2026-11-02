// Pure Community rules (validation, limits, helpers). Same limits are enforced again by the database (007_community.sql).
export const LIMITS = { post: 2000, comment: 1000, name: 40, bio: 300, groupName: 60, groupDesc: 500, report: 500, search: 60, media: 52428800 }
export const PAGE = 15
export const REACTIONS = [
  { kind: 'like', emoji: '👍', label: 'Like' },
  { kind: 'love', emoji: '❤️', label: 'Love' },
  { kind: 'support', emoji: '🤝', label: 'Support' },
  { kind: 'celebrate', emoji: '🎉', label: 'Celebrate' },
]
export const REPORT_REASONS = [
  { value: 'spam', label: 'Spam' }, { value: 'abuse', label: 'Abuse' }, { value: 'harassment', label: 'Harassment' }, { value: 'hate', label: 'Hate speech' },
  { value: 'violence', label: 'Violence or threats' }, { value: 'sexual', label: 'Sexual content' }, { value: 'self_harm', label: 'Self-harm' },
  { value: 'misinformation', label: 'Misinformation' }, { value: 'other', label: 'Something else' },
]
export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
export const VIDEO_MIME = ['video/mp4', 'video/webm', 'video/quicktime']
const EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }

export const isAdminUser = (user) => ['admin', 'owner'].includes(user?.app_metadata?.role) // display only; the database enforces it

export const clean = (s) => String(s ?? '').replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim()

export function validatePost({ body, file }) {
  const text = clean(body)
  if (!text && !file) return 'Write something or add a photo or video.'
  if (text.length > LIMITS.post) return 'Posts can be up to 2000 characters.'
  if (file) return validateMedia(file)
  return null
}
export function validateComment(body, { voice = false } = {}) {
  const t = clean(body)
  if (!t && voice) return null // a voice comment needs no text
  if (!t) return 'Write a comment first.'
  if (t.length > LIMITS.comment) return 'Comments can be up to 1000 characters.'
  return null
}
export function validateProfile({ display_name, bio }) {
  const n = clean(display_name)
  if (n.length < 2 || n.length > LIMITS.name) return 'Choose a display name of 2 to 40 characters.'
  if (clean(bio).length > LIMITS.bio) return 'The bio can be up to 300 characters.'
  return null
}
export function validateGroup({ name, description }) {
  const n = clean(name)
  if (n.length < 3 || n.length > LIMITS.groupName) return 'A group name needs 3 to 60 characters.'
  if (clean(description).length > LIMITS.groupDesc) return 'The description can be up to 500 characters.'
  return null
}
export function validateMedia(file) {
  if (!file) return null
  if (![...IMAGE_MIME, ...VIDEO_MIME].includes(file.type)) return 'Use a JPEG, PNG, WebP, GIF, AVIF, MP4, WebM or MOV file.'
  if (file.size > LIMITS.media) return 'Files can be up to 50 MB.'
  if (file.size <= 0) return 'This file is empty.'
  return null
}
export const mediaKindOf = (mime) => (IMAGE_MIME.includes(mime) ? 'image' : VIDEO_MIME.includes(mime) ? 'video' : null)

/** Storage path for an upload. First folder is the user's id, which the storage policy requires. */
export function mediaPath(userId, mime, id) {
  const ext = EXT[mime]
  if (!ext) throw new Error('Unsupported file type.')
  return `${userId}/${id}.${ext}`
}

/** Search text -> safe ILIKE pattern ('' when nothing usable). Strips characters that mean something inside a PostgREST filter. */
export function searchPattern(text) {
  const c = String(text || '').trim().slice(0, LIMITS.search).replace(/[%_\\*(),."']/g, ' ').replace(/\s+/g, ' ').trim()
  return c ? `%${c}%` : ''
}

export const initials = (name) => (String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?')

export function timeAgo(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (!Number.isFinite(s)) return ''
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 604800) return `${Math.floor(s / 86400)}d`
  return new Date(iso).toLocaleDateString()
}

/** Group a flat comment list into top-level comments with their replies (one level deep, as the UI shows them). */
export function threadComments(list) {
  const byParent = new Map()
  const top = []
  for (const c of list) {
    if (!c.parent_id) top.push(c)
    else (byParent.get(c.parent_id) || byParent.set(c.parent_id, []).get(c.parent_id)).push(c)
  }
  return top.map((c) => ({ ...c, replies: byParent.get(c.id) || [] }))
}

/** Updates a post's reaction counters locally after the user reacts (optimistic UI; the server stays the truth). */
export function applyReaction(post, kind) {
  const had = post.my_reaction
  const count = Number(post.reaction_count || 0)
  if (!kind) return { ...post, my_reaction: null, reaction_count: Math.max(0, count - (had ? 1 : 0)) }
  return { ...post, my_reaction: kind, reaction_count: count + (had ? 0 : 1) }
}

/** Errors from the database triggers/policies -> friendly text. */
export function communityError(e) {
  const m = String(e?.message || e || '')
  if (/rate_limited/.test(m)) return 'You are doing that too quickly. Please wait a little and try again.'
  if (/comments_closed/.test(m)) return 'Comments are closed on this post.'
  if (/moderation_only/.test(m)) return 'Only moderators can do that.'
  if (/row-level security|violates row/.test(m)) return 'You do not have permission to do that (your account may be restricted).'
  if (/duplicate key|23505/.test(m)) return 'You have already done that.'
  return null
}
