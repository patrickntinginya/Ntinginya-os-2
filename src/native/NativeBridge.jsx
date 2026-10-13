import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { isNativePlatform } from '../lib/platform'
import { supabase } from '../lib/supabase'
import { createAuthDeepLinkHandler } from '../services/authDeepLink'
import { getCoordinator, getNotifier, repository } from './runtime'

/**
 * Invisible component that connects the Android shell to the app. It does NOTHING in a browser (isNativePlatform() is false).
 * Responsibilities on Android: email-link deep links, who is signed in (for local storage), background sync of queued reminder
 * changes, rebuilding reminder alarms, and opening the right reminder when a notification is tapped.
 */
export default function NativeBridge() {
  const native = isNativePlatform()
  const navigate = useNavigate()
  const navRef = useRef(navigate)
  navRef.current = navigate
  const { user, profile } = useAuth()
  const userId = user?.id ?? null
  const previousUser = useRef(null)
  const notificationsOn = Boolean(profile?.notifications_enabled)
  const profileReady = Boolean(profile)

  // 1. Email links (sign-up confirmation, password reset) come back to the app as a deep link.
  useEffect(() => {
    if (!native) return undefined
    let cancelled = false
    let subscription
    const handler = createAuthDeepLinkHandler({ auth: supabase.auth, navigate: (...args) => navRef.current(...args), storage: window.localStorage })
    import('@capacitor/app')
      .then(async ({ App }) => {
        subscription = await App.addListener('appUrlOpen', ({ url }) => { handler(url).catch(() => {}) })
        if (cancelled) return subscription.remove()
        const launch = await App.getLaunchUrl()
        if (launch?.url) await handler(launch.url)
        return undefined
      })
      .catch(() => {})
    return () => {
      cancelled = true
      subscription?.remove()
    }
  }, [native])

  // 2. Local data belongs to the signed-in user. When the user changes, clean up the previous one without touching others.
  useEffect(() => {
    if (!native) return
    const previous = previousUser.current
    previousUser.current = userId
    repository.setUser(userId)
    if (previous && previous !== userId) getCoordinator().then((c) => c.userLeft(previous)).catch(() => {})
  }, [native, userId])

  // 3. Keep queued changes synced and the Android alarms in step with the reminders.
  useEffect(() => {
    if (!native || !userId || !profileReady) return undefined
    let timer
    let appListener
    let disposed = false
    const rebuild = () => {
      clearTimeout(timer)
      timer = setTimeout(() => getCoordinator().then((c) => c.run({ enabled: notificationsOn })).catch(() => {}), 800)
    }
    const syncNow = () => repository.sync({ force: true }).catch(() => {})
    const onOnline = () => { syncNow(); rebuild() }
    const off = repository.subscribe((event) => { if (event.type === 'changed' || event.type === 'synced') rebuild() })
    window.addEventListener('online', onOnline)
    window.addEventListener('life-os:reminders-changed', rebuild) // reminders written by other screens (Today, AI actions)
    const interval = setInterval(() => repository.sync().catch(() => {}), 30000)
    import('@capacitor/app')
      .then(({ App }) => App.addListener('appStateChange', ({ isActive }) => { if (isActive) { syncNow(); rebuild() } }))
      .then((h) => { if (disposed) h.remove(); else appListener = h })
      .catch(() => {})
    syncNow()
    rebuild()
    return () => {
      disposed = true
      clearTimeout(timer)
      clearInterval(interval)
      off()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('life-os:reminders-changed', rebuild)
      appListener?.remove()
    }
  }, [native, userId, profileReady, notificationsOn])

  // 4. Tapping a notification opens that reminder.
  useEffect(() => {
    if (!native) return undefined
    let handle
    let disposed = false
    getNotifier()
      .then((n) => n.onTap((route) => navRef.current(route)))
      .then((h) => { if (disposed) h.remove(); else handle = h })
      .catch(() => {})
    return () => {
      disposed = true
      handle?.remove()
    }
  }, [native])

  return null
}
