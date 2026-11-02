import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { syncNotifications, unreadCount } from '../services/notifications'
import { expandEvents } from '../utils/metrics'
import { addDays, timeToMinutes, todayISO } from '../utils/date'

/** Unread notification count for the header badge. */
export function useUnreadCount() {
  const [count, setCount] = useState(0)
  const refresh = useCallback(() => unreadCount().then(setCount).catch(() => {}), [])
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 120000)
    window.addEventListener('life-os:notifications-changed', refresh)
    return () => {
      clearInterval(id)
      window.removeEventListener('life-os:notifications-changed', refresh)
    }
  }, [refresh])
  return count
}

/** Builds in-app notifications from real data on load and every 15 minutes while the app is open. */
export function useNotificationSync() {
  useEffect(() => {
    const run = () =>
      syncNotifications()
        .then(() => window.dispatchEvent(new Event('life-os:notifications-changed')))
        .catch(() => {})
    run()
    const id = setInterval(run, 15 * 60 * 1000)
    return () => clearInterval(id)
  }, [])
}

const SEEN_KEY = 'life-os-notified'
const loadSeen = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'))
  } catch {
    return new Set()
  }
}
const saveSeen = (set) => localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-300)))

async function show(title, body, tag) {
  const options = { body, tag, icon: '/pwa-192.png', badge: '/pwa-192.png' }
  const reg = await navigator.serviceWorker?.getRegistration()
  if (reg) await reg.showNotification(title, options)
  else new Notification(title, options)
}

/**
 * Device notifications for due reminders and event alerts.
 * HONEST LIMIT: browsers cannot schedule notifications for a closed app without a push server.
 * This checks every minute while the app (or installed PWA) is open or running in the background,
 * and shows each due item once.
 */
export function useDeviceNotifications(enabled) {
  useEffect(() => {
    if (!enabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return undefined
    let stopped = false

    const tick = async () => {
      const today = todayISO()
      const now = new Date()
      const nowMin = now.getHours() * 60 + now.getMinutes()
      const seen = loadSeen()
      let changed = false
      try {
        const [{ data: reminders }, { data: events }] = await Promise.all([
          supabase.from('reminders').select('*').eq('is_done', false).eq('remind_date', today),
          supabase.from('schedule_events').select('*').not('reminder_minutes', 'is', null).lte('event_date', today).limit(500),
        ])
        for (const r of reminders || []) {
          const due = r.remind_time ? timeToMinutes(r.remind_time) : 0
          const key = `r:${r.id}:${today}`
          if (nowMin >= due && !seen.has(key) && !stopped) {
            await show(r.title, r.description || 'Reminder', key)
            seen.add(key)
            changed = true
          }
        }
        for (const e of expandEvents(events || [], today, addDays(today, 0))) {
          const due = timeToMinutes(e.start_time) - (e.reminder_minutes ?? 0)
          const key = `e:${e.id}:${today}`
          if (nowMin >= due && nowMin < timeToMinutes(e.start_time) + 60 && !seen.has(key) && !stopped) {
            await show(e.title, `Starts at ${String(e.start_time).slice(0, 5)}${e.location ? ` - ${e.location}` : ''}`, key)
            seen.add(key)
            changed = true
          }
        }
      } catch {
        /* network or permission problem: try again next minute */
      }
      if (changed) saveSeen(seen)
    }

    tick()
    const id = setInterval(tick, 60000)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [enabled])
}
