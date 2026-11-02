// Supabase Realtime wiring for chat, with the client INJECTED (tests use a fake).
//  * Row changes (new/edited/deleted messages, delivery/read marks) arrive via postgres_changes and are filtered by the database's RLS.
//  * Typing and presence use a PRIVATE broadcast channel "chat:<conversation id>"; Realtime Authorization (migration 010) only admits members.
//    Typing/presence are cosmetic: a member could fake another member's "typing" dot, but cannot read or write anything else.
import { CHAT } from '../utils/chat.js'

export function openConversationChannel(client, { conversationId, me, onMessage, onMessageUpdate, onMembers, onTyping, onPresence, onStatus }) {
  const channel = client.channel(`chat:${conversationId}`, { config: { private: true, broadcast: { self: false }, presence: { key: me } } })
  const filter = `conversation_id=eq.${conversationId}`
  channel
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter }, (p) => p && p.new && onMessage && onMessage(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter }, (p) => p && p.new && onMessageUpdate && onMessageUpdate(p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_members', filter }, (p) => p && p.new && onMembers && onMembers(p.new))
    .on('broadcast', { event: 'typing' }, (m) => { const d = m && m.payload; if (d && d.user_id && d.user_id !== me && onTyping) onTyping(d.user_id, d.typing !== false) })
    .on('presence', { event: 'sync' }, () => { if (onPresence) onPresence(Object.keys(channel.presenceState ? channel.presenceState() : {})) })
    .subscribe(async (status) => {
      if (onStatus) onStatus(status)
      if (status === 'SUBSCRIBED' && channel.track) { try { await channel.track({ user_id: me, at: Date.now() }) } catch { /* presence is optional */ } }
    })
  let lastSent = 0
  return {
    /** Tells the others I am typing (at most once per CHAT.typingEvery) or have stopped. Returns whether anything was sent. */
    sendTyping(typing, now = Date.now()) {
      if (typing && now - lastSent < CHAT.typingEvery) return false
      lastSent = typing ? now : 0
      channel.send({ type: 'broadcast', event: 'typing', payload: { user_id: me, typing: Boolean(typing) } })
      return true
    },
    close() { client.removeChannel(channel) },
  }
}

/** Changes to MY conversation list (new chat, new message bumping last_message_at, someone added/removed me). The caller refreshes the inbox. */
export function openInboxChannel(client, { me, onChange }) {
  const channel = client.channel(`inbox:${me}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversations' }, () => onChange())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_members', filter: `user_id=eq.${me}` }, () => onChange())
    .subscribe()
  return { close() { client.removeChannel(channel) } }
}
