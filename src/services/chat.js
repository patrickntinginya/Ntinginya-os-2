// Chat data access. The database enforces every rule (see migration 010); this file only calls it and shapes the results.
// The Supabase client is a PARAMETER (see chatApi.js for the real one) so tests can pass a fake and need no installed packages.
import { signUrls } from '../lib/signedUrls.js'
import { isAlreadyUploaded, uploadToBucket } from '../lib/storageUpload.js'
import { baseMime, validateVoice } from '../lib/voiceFormat.js'
import { uuidv4 } from '../lib/uuid.js'
import { searchPattern } from '../utils/community.js'
import { CHAT, attachmentKind, chatMediaPath, cleanText } from '../utils/chat.js'

export const CHAT_BUCKET = 'chat-media'
const ok = ({ data, error }) => { if (error) throw error; return data }

/** Uploads one chat attachment (see lib/storageUpload.js for the progress / fallback rules). */
export const uploadAttachment = (client, path, file, opts) => uploadToBucket(client, CHAT_BUCKET, path, file, opts)

export function createChatService(client) {
  const rpc = async (name, args) => ok(await client.rpc(name, args))
  return {
    inbox: async () => (await rpc('chat_inbox')) || [],
    startDirect: (otherId) => rpc('chat_start_direct', { p_other: otherId }),
    createGroup: (title, memberIds) => rpc('chat_create_group', { p_title: cleanText(title), p_members: [...new Set(memberIds)] }),
    addMembers: (conv, ids) => rpc('chat_add_members', { p_conv: conv, p_members: [...new Set(ids)] }),
    removeMember: (conv, userId) => rpc('chat_remove_member', { p_conv: conv, p_user: userId }),
    leave: (conv) => rpc('chat_leave', { p_conv: conv }),
    rename: (conv, title) => rpc('chat_rename', { p_conv: conv, p_title: cleanText(title) }),
    setMuted: (conv, muted) => rpc('chat_set_muted', { p_conv: conv, p_muted: Boolean(muted) }),
    mark: (conv, read = true) => rpc('chat_mark', { p_conv: conv, p_read: read }),
    markAllDelivered: () => rpc('chat_mark_all_delivered'),
    touch: () => rpc('chat_touch'),
    lastSeenOf: (userId) => rpc('chat_last_seen_of', { p_user: userId }),
    members: async (conv) => ok(await client.from('chat_members').select('*').eq('conversation_id', conv).is('left_at', null)) || [],
    conversation: async (conv) => ok(await client.from('chat_conversations').select('*').eq('id', conv).maybeSingle()),

    /** Newest first, `before` is the created_at of the oldest message already loaded. */
    async messages(conv, { before = null, limit = CHAT.page } = {}) {
      let q = client.from('chat_messages').select('*').eq('conversation_id', conv).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit)
      if (before) q = q.lt('created_at', before)
      const rows = ok(await q) || []
      return { rows: rows.reverse(), hasMore: rows.length === limit }
    },
    /** Search inside one conversation (or all of mine when conv is null). Row security limits it to what I may read. */
    async search(text, conv = null) {
      const pattern = searchPattern(text)
      if (!pattern) return []
      let q = client.from('chat_messages').select('*').is('deleted_at', null).ilike('body', pattern).order('created_at', { ascending: false }).limit(40)
      if (conv) q = q.eq('conversation_id', conv)
      return ok(await q) || []
    },

    /** Uploads the attachment (if any), then inserts the message. The client id makes a retry idempotent (unique per conversation+sender). */
    async send({ conversationId, me, body, file = null, kind = null, durationMs = null, replyTo = null, clientId = uuidv4(), onUploaded = null, onProgress = null, signal = null, uploadFn }) {
      const text = cleanText(body)
      let media = {}
      let path = null
      if (file) {
        const k = kind || attachmentKind(file.type)
        if (k === 'voice') { const bad = validateVoice({ durationMs, size: file.size, mime: file.type }); if (bad) throw new Error(bad) }
        if (!k) throw new Error('That file type is not allowed in chat.')
        path = chatMediaPath(me, conversationId, clientId, file.name || 'file')
        try { await uploadAttachment(client, path, file, { onProgress, signal, uploadFn }) } catch (e) { if (!isAlreadyUploaded(e)) throw e } // a retry of an upload that already arrived continues
        media = { kind: k, media_path: path, media_name: String(file.name || 'file').slice(0, 120), media_mime: baseMime(file.type) || null, media_size: file.size, duration_ms: k === 'voice' ? Math.round(durationMs || 0) : durationMs }
        if (onUploaded) onUploaded(path)
      }
      const row = { conversation_id: conversationId, sender_id: me, client_id: clientId, kind: 'text', body: text || null, reply_to: replyTo, ...media }
      const { data, error } = await client.from('chat_messages').insert(row).select().single()
      if (error) {
        if (error.code === '23505') { // a retry of a message that already arrived: return the stored one, do not duplicate
          const existing = ok(await client.from('chat_messages').select('*').eq('conversation_id', conversationId).eq('sender_id', me).eq('client_id', clientId).maybeSingle())
          if (existing) return existing
        }
        if (path) await client.storage.from(CHAT_BUCKET).remove([path]) // never leave an upload with no message
        throw error
      }
      return data
    },
    edit: (messageId, body) => rpc('chat_edit', { p_message: messageId, p_body: cleanText(body) }),
    /**
     * Deletes the message and its file. ORDER MATTERS: since migration 011 a file is readable (and therefore removable through the Storage API,
     * which needs read access to find it) only while a live message points at it, so the file goes FIRST and the message second. If the file
     * cannot be removed (for example the sender already left the group) the message is still deleted: nobody can read the orphan file, and the
     * cleanup job (scripts/cleanup-chat-media.mjs) deletes it later.
     */
    async remove(messageId) {
      const row = ok(await client.from('chat_messages').select('media_path').eq('id', messageId).maybeSingle())
      if (row && row.media_path) { try { await client.storage.from(CHAT_BUCKET).remove([row.media_path]) } catch { /* the cleanup job handles it */ } }
      await rpc('chat_delete', { p_message: messageId })
    },
    report: (messageId, reason, details = null) => rpc('chat_report', { p_message: messageId, p_reason: reason, p_details: details }),

    /** Display names/avatars for member ids (Community profiles). */
    async profiles(ids) {
      const list = [...new Set((ids || []).filter(Boolean))]
      if (!list.length) return {}
      const rows = ok(await client.from('community_profiles').select('user_id,display_name,avatar_path,status').in('user_id', list)) || []
      return Object.fromEntries(rows.map((r) => [r.user_id, r]))
    },
    async findMembers(text) {
      const pattern = searchPattern(text)
      if (!pattern) return []
      return ok(await client.from('community_profiles').select('user_id,display_name,avatar_path').eq('status', 'active').ilike('display_name', pattern).limit(20)) || []
    },
    signMedia: (paths, seconds = 900) => signUrls(client, CHAT_BUCKET, paths, { seconds }),
    async settings(userId) { return ok(await client.from('chat_settings').select('*').eq('user_id', userId).maybeSingle()) || { user_id: userId, show_last_seen: true, allow_new_chats: true } },
    async saveSettings(userId, { show_last_seen, allow_new_chats }) {
      return ok(await client.from('chat_settings').upsert({ user_id: userId, show_last_seen: Boolean(show_last_seen), allow_new_chats: Boolean(allow_new_chats), updated_at: new Date().toISOString() }).select().single())
    },
  }
}
