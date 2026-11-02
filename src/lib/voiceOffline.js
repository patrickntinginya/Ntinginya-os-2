// Which chat voice messages may be saved on this device, and how they are described. Only a LIVE voice message the person can read right now
// may be downloaded (the server checks the same thing when it signs the download link). The saved copy then belongs to this device: it is removed when
// the person deletes it, leaves the conversation, or the message turns out to be deleted (see ConversationView). Nothing here is shared or uploaded.
import { VOICE } from './voiceFormat.js'

export const VOICE_DB_PREFIX = 'ntinginya-offline-voice'
const SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[^/]+$/

/** { ok:true } or { ok:false, code } with the same codes the screens already translate. */
export function voiceEligible(item) {
  if (!item || typeof item.id !== 'string' || typeof item.storage_path !== 'string') return { ok: false, code: 'not_cloud' }
  if (item.media_type !== 'audio' || !SHAPE.test(item.storage_path)) return { ok: false, code: 'not_allowed' }
  const size = Number(item.size_bytes)
  if (!Number.isFinite(size) || size <= 0 || size > VOICE.maxBytes) return { ok: false, code: 'too_big' }
  return { ok: true }
}

/** The offline-library item for a chat message (kind 'voice'). */
export function voiceItem(message, { senderName = '', conversationTitle = '' } = {}) {
  if (!message || message.kind !== 'voice' || message.deleted_at || !message.media_path) return null
  const m = SHAPE.exec(message.media_path)
  return {
    id: message.id, title: senderName || 'Voice message', media_type: 'audio', mime_type: message.media_mime || null, size_bytes: message.media_size,
    storage_path: message.media_path, visibility: 'chat', created_at: message.created_at,
    extra: { conversation_id: m ? m[1] : null, conversation_title: conversationTitle || null, duration_ms: message.duration_ms || null, sender_id: message.sender_id },
  }
}

/** Why a save failed, as an English phrase the screens pass through tr(). Codes come from the offline core. */
export const VOICE_SAVE_ERRORS = {
  no_space: 'Not enough free space on this device.',
  network: 'The connection dropped. Try again.',
  expired: 'The download link expired. Try again.',
  missing: 'This voice message no longer exists.',
  size_mismatch: 'The file arrived incomplete. Try again.',
  storage: 'The device could not store this file. Free some space and try again.',
  too_big: 'This voice message is too large to save.',
  not_allowed: 'This voice message cannot be saved.',
  not_cloud: 'This voice message cannot be saved.',
  unsupported: 'This browser cannot store files for offline use.',
  url: 'Could not get a download link. Try again.',
  http: 'The download failed. Try again.',
}
export const voiceSaveError = (code) => VOICE_SAVE_ERRORS[code] || VOICE_SAVE_ERRORS.http
