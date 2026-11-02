import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { chat } from '../services/chatApi'
import { openInboxChannel } from '../lib/chatRealtime'

/** My conversation list, kept fresh by Realtime. Also tells the others that my device received their messages (delivered) and that I am around (last seen). */
export function useChatInbox(me) {
  const [rows, setRows] = useState([])
  const [profiles, setProfiles] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const alive = useRef(true)
  const timer = useRef(null)

  const load = useCallback(async () => {
    try {
      const list = await chat.inbox()
      const p = await chat.profiles(list.map((r) => r.other_user))
      if (!alive.current) return
      setRows(list); setProfiles((prev) => ({ ...prev, ...p })); setError(null)
      chat.markAllDelivered().catch(() => {})
    } catch (e) { if (alive.current) setError(e) } finally { if (alive.current) setLoading(false) }
  }, [])
  const schedule = useCallback(() => { clearTimeout(timer.current); timer.current = setTimeout(load, 400) }, [load]) // many events at once -> one refresh

  useEffect(() => {
    alive.current = true
    load()
    const handle = openInboxChannel(supabase, { me, onChange: schedule })
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', load)
    const touch = () => { if (document.visibilityState === 'visible') chat.touch().catch(() => {}) }
    touch()
    const iv = setInterval(touch, 60000)
    return () => { alive.current = false; clearTimeout(timer.current); clearInterval(iv); handle.close(); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', load) }
  }, [me, load, schedule])

  const unreadTotal = rows.reduce((n, r) => n + (r.muted ? 0 : Number(r.unread) || 0), 0)
  return { rows, profiles, loading, error, refresh: load, unreadTotal }
}
