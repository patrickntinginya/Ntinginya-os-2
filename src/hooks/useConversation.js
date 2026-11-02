import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { chat } from '../services/chatApi'
import { openConversationChannel } from '../lib/chatRealtime'
import { createTypingTracker, mergeMessages, optimisticMessage, chatError, lastSeenInfo } from '../utils/chat'
import { uuidv4 } from '../lib/uuid'

/** One open conversation: history (paged), live updates, typing, presence, read/delivered marks, optimistic sending with retry, signed media URLs. */
export function useConversation(id, me) {
  const [conv, setConv] = useState(null)
  const [members, setMembers] = useState([])
  const [messages, setMessages] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState(null)
  const [profiles, setProfiles] = useState({})
  const [online, setOnline] = useState([])
  const [live, setLive] = useState('connecting') // connecting | live | offline
  const [urls, setUrls] = useState({})
  const [urlIssue, setUrlIssue] = useState(null)
  const [lastSeen, setLastSeen] = useState(null)
  const [, force] = useReducer((x) => x + 1, 0)
  const tracker = useRef(createTypingTracker())
  const handle = useRef(null)
  const alive = useRef(true)
  const pending = useRef(new Map()) // client id -> what is needed to retry
  const signing = useRef(new Set())
  const typingCount = useRef(0)

  const visible = () => document.visibilityState === 'visible'
  const markRead = useCallback(() => { chat.mark(id, visible()).catch(() => {}) }, [id])

  const addProfiles = useCallback(async (ids) => {
    const p = await chat.profiles(ids).catch(() => ({}))
    if (alive.current) setProfiles((prev) => ({ ...prev, ...p }))
  }, [])

  const refetchLatest = useCallback(async () => { // after a reconnect: fetch whatever was missed while the socket was down
    try { const page = await chat.messages(id); if (alive.current) setMessages((l) => mergeMessages(l, page.rows)); markRead() } catch { /* the next event retries */ }
  }, [id, markRead])

  useEffect(() => {
    alive.current = true
    setLoading(true); setError(null); setMessages([]); setUrls({}); tracker.current.clear()
    ;(async () => {
      try {
        const [c, m, page] = await Promise.all([chat.conversation(id), chat.members(id), chat.messages(id)])
        if (!alive.current) return
        if (!c) { setError(new Error('not_found')); return }
        setConv(c); setMembers(m); setMessages(page.rows); setHasMore(page.hasMore)
        addProfiles(m.map((x) => x.user_id))
        markRead()
      } catch (e) { if (alive.current) setError(e) } finally { if (alive.current) setLoading(false) }
    })()
    return () => { alive.current = false }
  }, [id, addProfiles, markRead])

  useEffect(() => {
    const h = openConversationChannel(supabase, {
      conversationId: id, me,
      onMessage: (m) => { setMessages((l) => mergeMessages(l, m)); if (m.sender_id !== me) { tracker.current.stopped(m.sender_id); markRead(); force() } },
      onMessageUpdate: (m) => setMessages((l) => mergeMessages(l, m)),
      onMembers: (row) => setMembers((l) => (l.some((x) => x.user_id === row.user_id) ? l.map((x) => (x.user_id === row.user_id ? { ...x, ...row } : x)) : [...l, row]).filter((x) => !x.left_at)),
      onTyping: (u, t) => { if (t) tracker.current.heard(u); else tracker.current.stopped(u); force() },
      onPresence: setOnline,
      onStatus: (s) => { if (s === 'SUBSCRIBED') { setLive('live'); refetchLatest() } else if (s === 'CLOSED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') setLive('offline') },
    })
    handle.current = h
    const iv = setInterval(() => { const n = tracker.current.active().length; if (n !== typingCount.current) { typingCount.current = n; force() } }, 1000)
    const onVisible = () => { if (visible()) markRead() }
    const onOnline = () => refetchLatest()
    document.addEventListener('visibilitychange', onVisible); window.addEventListener('online', onOnline)
    return () => { clearInterval(iv); h.close(); handle.current = null; document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onOnline) }
  }, [id, me, markRead, refetchLatest])

  // Signed URLs for attachments (private bucket), requested in one batch for whatever is not signed yet.
  useEffect(() => {
    const need = [...new Set(messages.filter((m) => m.media_path && !m.deleted_at && !urls[m.media_path] && !signing.current.has(m.media_path)).map((m) => m.media_path))]
    if (!need.length) return
    need.forEach((p) => signing.current.add(p))
    chat.signMedia(need, 3600).then((r) => {
      need.forEach((p) => signing.current.delete(p))
      if (!alive.current) return
      setUrls((prev) => ({ ...prev, ...r.urls })); setUrlIssue(r.failed.length ? r.reason : null)
    }).catch(() => { need.forEach((p) => signing.current.delete(p)) })
  }, [messages, urls])
  const resign = useCallback((path) => setUrls((prev) => { const n = { ...prev }; delete n[path]; return n }), [])

  // Last seen of the other person in a direct chat (null when they hide it or we share nothing).
  const otherId = conv && conv.kind === 'direct' ? (members.find((m) => m.user_id !== me) || {}).user_id : null
  useEffect(() => {
    if (!otherId) { setLastSeen(null); return undefined }
    let live2 = true
    const get = () => chat.lastSeenOf(otherId).then((v) => live2 && setLastSeen(v)).catch(() => {})
    get(); const iv = setInterval(get, 60000)
    return () => { live2 = false; clearInterval(iv) }
  }, [otherId])

  const sendWith = useCallback(async (clientId, args) => {
    const tmpId = `tmp-${clientId}`
    setMessages((l) => mergeMessages(l, optimisticMessage({ id: tmpId, clientId, conversationId: id, me, body: args.body, kind: args.kind || (args.file ? 'file' : 'text'), file: args.file, durationMs: args.durationMs })))
    try {
      const onProgress = (p) => setMessages((l) => l.map((x) => (x.id === tmpId ? { ...x, _progress: p.percent } : x)))
      const row = await chat.send({ conversationId: id, me, clientId, ...args, onProgress: args.file ? onProgress : null })
      pending.current.delete(clientId)
      setMessages((l) => mergeMessages(l, row))
      if (handle.current) handle.current.sendTyping(false)
      return { ok: true }
    } catch (e) {
      setMessages((l) => l.map((x) => (x.id === tmpId ? { ...x, _pending: false, _failed: true, _error: chatError(e) || (e && e.message) } : x)))
      return { ok: false, error: chatError(e) }
    }
  }, [id, me])
  const send = useCallback((args) => { const clientId = uuidv4(); pending.current.set(clientId, args); return sendWith(clientId, args) }, [sendWith])
  const retry = useCallback((msg) => { const args = pending.current.get(msg.client_id); if (!args) return Promise.resolve({ ok: false }); return sendWith(msg.client_id, args) }, [sendWith])
  const discard = useCallback((msg) => { pending.current.delete(msg.client_id); setMessages((l) => l.filter((x) => x.id !== msg.id)) }, [])

  const edit = useCallback(async (messageId, body) => { await chat.edit(messageId, body); setMessages((l) => l.map((x) => (x.id === messageId ? { ...x, body: body.trim(), edited_at: new Date().toISOString() } : x))) }, [])
  const remove = useCallback(async (messageId) => { await chat.remove(messageId); setMessages((l) => l.map((x) => (x.id === messageId ? { ...x, deleted_at: new Date().toISOString(), body: null, media_path: null } : x))) }, [])
  const loadOlder = useCallback(async () => {
    const first = messages.find((m) => !m._pending && !m._failed)
    if (!first || loadingOlder) return
    setLoadingOlder(true)
    try { const page = await chat.messages(id, { before: first.created_at }); setMessages((l) => mergeMessages(l, page.rows)); setHasMore(page.hasMore) } finally { setLoadingOlder(false) }
  }, [id, messages, loadingOlder])
  const typing = useCallback((text) => { if (handle.current) handle.current.sendTyping(Boolean(text && text.trim())) }, [])
  const reloadMembers = useCallback(async () => { const [c, m] = await Promise.all([chat.conversation(id), chat.members(id)]); setConv(c); setMembers(m); addProfiles(m.map((x) => x.user_id)) }, [id, addProfiles])

  const typingNames = tracker.current.active().map((u) => (profiles[u] && profiles[u].display_name) || '').filter(Boolean)
  return { conv, members, messages, hasMore, loading, loadingOlder, error, profiles, online, live, urls, urlIssue, resign, typingNames, send, retry, discard, edit, remove, loadOlder, typing, reloadMembers, otherId, lastSeen, lastSeenInfo }
}
