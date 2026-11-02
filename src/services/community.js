import { supabase } from '../lib/supabase'
import { uuidv4 } from '../lib/uuid'
import { PAGE, clean, mediaKindOf, mediaPath, searchPattern, validateMedia } from '../utils/community'
import { uploadToBucket } from '../lib/storageUpload'
import { baseMime, validateVoice } from '../lib/voiceFormat'
import { signUrls } from '../lib/signedUrls'

const BUCKET = 'community-media'
const q = (v) => `"${String(v).replace(/"/g, '')}"`
const ok = ({ data, error }) => { if (error) throw error; return data }

// ---------- profile ----------
export async function getMyProfile(userId) {
  const { data, error } = await supabase.from('community_profiles').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data
}
export async function createProfile(userId, { display_name, bio = null }) {
  return ok(await supabase.from('community_profiles').insert({ user_id: userId, display_name: clean(display_name), bio: clean(bio) || null }).select().single())
}
export async function saveProfile(userId, { display_name, bio, show_bio, avatarFile }) {
  const patch = { display_name: clean(display_name), bio: clean(bio) || null, show_bio: Boolean(show_bio) }
  if (avatarFile) {
    const problem = validateMedia(avatarFile)
    if (problem || mediaKindOf(avatarFile.type) !== 'image') throw new Error('Choose a JPEG, PNG, WebP, GIF or AVIF picture up to 50 MB.')
    const path = mediaPath(userId, avatarFile.type, `avatar-${uuidv4()}`)
    ok(await supabase.storage.from(BUCKET).upload(path, avatarFile, { contentType: avatarFile.type, upsert: false }))
    patch.avatar_path = path
  }
  return ok(await supabase.from('community_profiles').update(patch).eq('user_id', userId).select().single())
}

// ---------- media URLs ----------
/** Signed URLs for a list of storage paths (private bucket). Returns { path: url }. */
export async function signedUrls(paths, seconds = 900) {
  const unique = [...new Set((paths || []).filter(Boolean))]
  if (!unique.length) return {}
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(unique, seconds)
  if (error) throw error
  return Object.fromEntries((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]))
}

// ---------- feed ----------
/**
 * One page of posts from the community_feed view (RLS hides blocked members, hidden posts and private-group posts).
 * scope: 'feed' (public posts), 'trending', 'group', 'mine', 'post' (one post by id). Keyset pagination on (created_at, id);
 * trending is ranked, so it pages by offset.
 */
export async function fetchPosts({ scope = 'feed', groupId = null, postId = null, search = '', userId = null, cursor = null, offset = 0, pageSize = PAGE } = {}) {
  let query = supabase.from('community_feed').select('*').eq('status', 'visible')
  if (scope === 'post') query = query.eq('id', postId) // opened from a notification link (/community?post=<id>); RLS still decides if it is visible
  else if (scope === 'group') query = query.eq('group_id', groupId)
  else if (scope === 'mine') query = query.eq('user_id', userId)
  else query = query.is('group_id', null)
  const pattern = searchPattern(search)
  if (pattern) query = query.or(`body.ilike.${q(pattern)},author_name.ilike.${q(pattern)}`)
  if (scope === 'trending') {
    query = query.gt('trend_score', 0).gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()).order('trend_score', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + pageSize)
  } else {
    query = query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(pageSize + 1)
    if (cursor) query = query.or(`created_at.lt.${q(cursor.created_at)},and(created_at.eq.${q(cursor.created_at)},id.lt.${q(cursor.id)})`)
  }
  const rows = ok(await query) ?? []
  const more = rows.length > pageSize
  const page = more ? rows.slice(0, pageSize) : rows
  const last = page[page.length - 1]
  return { rows: page, more, nextCursor: more && last ? { created_at: last.created_at, id: last.id } : null, nextOffset: offset + page.length }
}

/**
 * `voice: { file, durationMs }` makes a voice post (the text is then optional). `onProgress({ percent })` reports the upload of a voice file.
 * The limits (5 min, 5 MB, audio type) are checked here for a friendly message and again by the database.
 */
export async function createPost(userId, { body, groupId = null, file = null, voice = null, allowComments = true, onProgress = null }) {
  const id = uuidv4()
  let media = {}
  let uploaded = null
  if (voice) {
    const problem = validateVoice({ durationMs: voice.durationMs, size: voice.file.size, mime: voice.file.type })
    if (problem) throw new Error(problem)
    const mime = baseMime(voice.file.type)
    uploaded = mediaPath(userId, mime, id)
    await uploadToBucket(supabase, BUCKET, uploaded, voice.file, { onProgress })
    media = { media_kind: 'voice', media_path: uploaded, media_mime: mime, duration_ms: Math.round(voice.durationMs), media_size: voice.file.size }
  } else if (file) {
    const problem = validateMedia(file)
    if (problem) throw new Error(problem)
    uploaded = mediaPath(userId, file.type, id)
    ok(await supabase.storage.from(BUCKET).upload(uploaded, file, { contentType: file.type, upsert: false }))
    media = { media_kind: mediaKindOf(file.type), media_path: uploaded, media_mime: file.type }
  }
  const { data, error } = await supabase.from('community_posts').insert({ id, body: clean(body), group_id: groupId, allow_comments: allowComments, ...media }).select().single()
  if (error) {
    if (uploaded) await supabase.storage.from(BUCKET).remove([uploaded]).catch(() => {}) // never leave an orphan file behind
    throw error
  }
  return data
}

export async function deletePost(post) {
  ok(await supabase.from('community_posts').delete().eq('id', post.id))
  if (post.media_path) await supabase.storage.from(BUCKET).remove([post.media_path]).catch(() => {})
}

// ---------- reactions ----------
/** kind = null removes the user's reaction. Safe to call twice (the database allows one reaction per member per post). */
export async function setReaction(postId, kind) {
  if (!kind) return ok(await supabase.from('community_reactions').delete().eq('post_id', postId))
  const upd = await supabase.from('community_reactions').update({ kind }).eq('post_id', postId).select('id')
  if (upd.error) throw upd.error
  if (upd.data?.length) return upd.data
  const ins = await supabase.from('community_reactions').insert({ post_id: postId, kind }).select('id')
  if (ins.error && ins.error.code !== '23505') throw ins.error
  return ins.data
}

// ---------- comments ----------
export async function fetchComments(postId) {
  const rows = ok(await supabase.from('community_comments').select('*').eq('post_id', postId).eq('status', 'visible').order('created_at', { ascending: true }).limit(300)) ?? []
  const ids = [...new Set(rows.map((r) => r.user_id))]
  const names = ids.length ? ok(await supabase.from('community_profiles').select('user_id,display_name').in('user_id', ids)) ?? [] : []
  const map = Object.fromEntries(names.map((n) => [n.user_id, n.display_name]))
  return rows.map((r) => ({ ...r, author_name: map[r.user_id] || 'Member' }))
}
/** A comment is text, a voice message, or both. `voice: { file, durationMs }`; `onProgress({ percent })` reports the upload. */
export async function addComment({ postId, parentId = null, body = '', userId = null, voice = null, onProgress = null }) {
  let media = {}
  let uploaded = null
  if (voice) {
    const problem = validateVoice({ durationMs: voice.durationMs, size: voice.file.size, mime: voice.file.type })
    if (problem) throw new Error(problem)
    const owner = userId || (await supabase.auth.getUser()).data.user.id
    const mime = baseMime(voice.file.type)
    uploaded = mediaPath(owner, mime, `c-${uuidv4()}`)
    await uploadToBucket(supabase, BUCKET, uploaded, voice.file, { onProgress })
    media = { media_kind: 'voice', media_path: uploaded, media_mime: mime, duration_ms: Math.round(voice.durationMs), media_size: voice.file.size }
  }
  const { data, error } = await supabase.from('community_comments').insert({ post_id: postId, parent_id: parentId, body: clean(body), ...media }).select().single()
  if (error) {
    if (uploaded) await supabase.storage.from(BUCKET).remove([uploaded]).catch(() => {})
    throw error
  }
  return data
}
/** Signed links for voice comments, with the shared retry / error handling. Returns { urls, failed, reason }. */
export const signCommentMedia = (paths, seconds = 900) => signUrls(supabase, BUCKET, paths, { seconds })
export async function deleteComment(comment) {
  const c = typeof comment === 'object' ? comment : { id: comment }
  ok(await supabase.from('community_comments').delete().eq('id', c.id))
  if (c.media_path) await supabase.storage.from(BUCKET).remove([c.media_path]).catch(() => {})
}

// ---------- reports and blocks ----------
export async function reportTarget({ postId = null, commentId = null, userId = null, reason, details }) {
  const row = { reason, details: clean(details) || null }
  if (postId) row.post_id = postId
  else if (commentId) row.comment_id = commentId
  else row.reported_user_id = userId
  const { error } = await supabase.from('community_reports').insert(row)
  if (error && error.code !== '23505') throw error // 23505: already reported by this member - treated as success
  return { duplicate: error?.code === '23505' }
}
export const blockUser = async (userId, name) => {
  const { error } = await supabase.from('community_blocks').insert({ blocked_user_id: userId, blocked_name: clean(name).slice(0, 40) || null })
  if (error && error.code !== '23505') throw error
}
export const unblockUser = async (userId) => ok(await supabase.from('community_blocks').delete().eq('blocked_user_id', userId))
export const listBlocks = async () => ok(await supabase.from('community_blocks').select('*').order('created_at', { ascending: false }).limit(200)) ?? []

// ---------- groups ----------
export async function fetchGroups({ search = '', mineOnly = false } = {}) {
  let query = supabase.from('community_groups_view').select('*').eq('status', 'active').order('member_count', { ascending: false }).limit(60)
  const pattern = searchPattern(search)
  if (pattern) query = query.or(`name.ilike.${q(pattern)},description.ilike.${q(pattern)}`)
  if (mineOnly) query = query.eq('my_status', 'active')
  return ok(await query) ?? []
}
export async function createGroup(userId, { name, description, privacy }) {
  const g = ok(await supabase.from('community_groups').insert({ name: clean(name), description: clean(description) || null, privacy: privacy === 'private' ? 'private' : 'public' }).select().single())
  const { error } = await supabase.from('community_group_members').insert({ group_id: g.id, user_id: userId, role: 'owner', status: 'active' })
  if (error) { await supabase.from('community_groups').delete().eq('id', g.id); throw error }
  return g
}
export async function joinGroup(userId, group) {
  const status = group.privacy === 'private' ? 'pending' : 'active'
  const { error } = await supabase.from('community_group_members').insert({ group_id: group.id, user_id: userId, role: 'member', status })
  if (error && error.code !== '23505') throw error
  return status
}
export const leaveGroup = async (userId, groupId) => ok(await supabase.from('community_group_members').delete().eq('group_id', groupId).eq('user_id', userId))
export const listJoinRequests = async (groupId) => ok(await supabase.from('community_group_members').select('id,user_id,created_at').eq('group_id', groupId).eq('status', 'pending').limit(100)) ?? []
export const decideJoinRequest = async (memberId, approve) => approve
  ? ok(await supabase.from('community_group_members').update({ status: 'active' }).eq('id', memberId))
  : ok(await supabase.from('community_group_members').delete().eq('id', memberId))

// ---------- administrator moderation (every call is re-checked by RLS / triggers on the server) ----------
export async function fetchReports(status = 'open') {
  const rows = ok(await supabase.from('community_reports').select('*').eq('status', status).order('created_at', { ascending: false }).limit(50)) ?? []
  const postIds = rows.map((r) => r.post_id).filter(Boolean)
  const commentIds = rows.map((r) => r.comment_id).filter(Boolean)
  const [posts, comments] = await Promise.all([
    postIds.length ? supabase.from('community_posts').select('id,body,status,user_id').in('id', postIds) : { data: [] },
    commentIds.length ? supabase.from('community_comments').select('id,body,status,user_id').in('id', commentIds) : { data: [] },
  ])
  const pm = Object.fromEntries((posts.data || []).map((p) => [p.id, p]))
  const cm = Object.fromEntries((comments.data || []).map((c) => [c.id, c]))
  return rows.map((r) => ({ ...r, post: pm[r.post_id] || null, comment: cm[r.comment_id] || null }))
}
async function logAction(action, targetType, targetId, reason) {
  ok(await supabase.from('community_moderation_log').insert({ action, target_type: targetType, target_id: targetId, reason: clean(reason) || null }))
}
export async function moderate({ report, action, note }) {
  // action: 'hide' | 'remove' | 'dismiss' | 'suspend_user'
  if (action === 'hide' || action === 'remove') {
    const status = action === 'hide' ? 'hidden' : 'removed'
    if (report.post_id) { ok(await supabase.from('community_posts').update({ status }).eq('id', report.post_id)); await logAction(`${action}_post`, 'post', report.post_id, note) }
    else if (report.comment_id) { ok(await supabase.from('community_comments').update({ status }).eq('id', report.comment_id)); await logAction(`${action}_comment`, 'comment', report.comment_id, note) }
  }
  if (action === 'suspend_user') {
    const uid = report.reported_user_id || report.post?.user_id || report.comment?.user_id
    if (uid) { ok(await supabase.from('community_profiles').update({ status: 'suspended', suspended_reason: clean(note).slice(0, 300) || null }).eq('user_id', uid)); await logAction('suspend_user', 'user', uid, note) }
  }
  ok(await supabase.from('community_reports').update({ status: action === 'dismiss' ? 'dismissed' : 'resolved', resolution_note: clean(note) || null, resolved_by: (await supabase.auth.getUser()).data.user?.id }).eq('id', report.id))
  await logAction(action === 'dismiss' ? 'dismiss_report' : 'resolve_report', 'report', report.id, note)
}
export const restoreUser = async (userId) => { ok(await supabase.from('community_profiles').update({ status: 'active', suspended_reason: null }).eq('user_id', userId)); await logAction('restore_user', 'user', userId, null) }
export const fetchSuspended = async () => ok(await supabase.from('community_profiles').select('user_id,display_name,suspended_reason').eq('status', 'suspended').limit(100)) ?? []
export const fetchModerationLog = async () => ok(await supabase.from('community_moderation_log').select('*').order('created_at', { ascending: false }).limit(50)) ?? []
