import { useCallback, useEffect, useRef, useState } from 'react'
import { useOfflineMedia } from './useOfflineMedia'
import { VOICE_DB_PREFIX, voiceEligible, voiceItem, voiceSaveError } from '../lib/voiceOffline'

/** Options shared by every place that stores voice messages: their own bucket, their own per-user database, their own (stricter) rule. */
export const VOICE_OFFLINE = { bucket: 'chat-media', dbPrefix: VOICE_DB_PREFIX, eligible: voiceEligible }

/**
 * Saving voice messages of ONE open conversation for offline listening. Only messages the person can read right now are offered (the server signs the
 * download link only for those). A saved copy is removed when the person removes it, when they leave or lose the conversation, or when the message is deleted.
 */
export function useVoiceSaved(me, { messages, conversationId, conversationTitle, nameOf }) {
  const off = useOfflineMedia(me, VOICE_OFFLINE)
  const [urls, setUrls] = useState({})
  const [busy, setBusy] = useState({})
  const [errors, setErrors] = useState({})
  const made = useRef(new Map())
  const { metas, playable, remove: removeLocal, removeWhere } = off

  // Saved messages play from the device: make a local URL for each one shown here.
  useEffect(() => {
    let live = true
    ;(async () => {
      for (const m of messages) {
        if (m.kind !== 'voice' || made.current.has(m.id) || !metas[m.id] || metas[m.id].status !== 'downloaded') continue
        const p = await playable(m.id).catch(() => null)
        if (p && live) { const u = URL.createObjectURL(p.blob); made.current.set(m.id, u); setUrls((prev) => ({ ...prev, [m.id]: u })) }
      }
    })()
    return () => { live = false }
  }, [messages, metas, playable])
  useEffect(() => () => { for (const u of made.current.values()) URL.revokeObjectURL(u); made.current.clear() }, [])

  // A message that was deleted takes its saved copy with it.
  useEffect(() => { for (const m of messages) if (m.deleted_at && metas[m.id]) removeLocal(m.id).catch(() => {}) }, [messages, metas, removeLocal])

  const forget = useCallback((id) => { const u = made.current.get(id); if (u) { URL.revokeObjectURL(u); made.current.delete(id) } setUrls((p) => { const n = { ...p }; delete n[id]; return n }) }, [])
  const save = useCallback(async (m) => {
    const item = voiceItem(m, { senderName: nameOf(m.sender_id), conversationTitle })
    if (!item) return
    setBusy((b) => ({ ...b, [m.id]: true })); setErrors((e) => ({ ...e, [m.id]: null }))
    const r = await off.download(item)
    setBusy((b) => { const n = { ...b }; delete n[m.id]; return n })
    if (!r.ok && r.code !== 'cancelled') setErrors((e) => ({ ...e, [m.id]: voiceSaveError(r.code) }))
  }, [off, nameOf, conversationTitle])
  const remove = useCallback(async (m) => { forget(m.id); await removeLocal(m.id) }, [forget, removeLocal])
  /** Called when the person leaves, or has lost access to, this conversation. */
  const purgeConversation = useCallback(async () => { const n = await removeWhere((meta) => meta.extra && meta.extra.conversation_id === conversationId); for (const id of [...made.current.keys()]) forget(id); return n }, [removeWhere, conversationId, forget])

  return {
    supported: off.supported,
    isSaved: (id) => Boolean(metas[id] && metas[id].status === 'downloaded'),
    busy: (id) => Boolean(busy[id]), localUrl: (id) => urls[id] || null, error: (id) => errors[id] || null,
    save, remove, purgeConversation,
  }
}
