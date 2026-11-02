import { useCallback, useEffect, useRef, useState } from 'react'
import { isNativePlatform } from '../lib/platform'
import { runDoIt, snoozeNotification, wakeDueNotifications, pendingSnoozes } from '../services/notifications'
import { createSnoozeScheduler, showWebNotification } from '../services/snoozeScheduler'
import { requiresConfirm } from '../utils/smartActions'
import { friendlyError } from '../utils/format'
import { isUuid } from '../lib/uuid'
import { tr } from '../i18n'

// One scheduler for the whole app, so two screens can never each keep their own timer for the same notification.
let scheduler = null
let schedulerPromise = null
export function getSnoozeScheduler() {
  schedulerPromise ||= (async () => {
    let plugin = null
    if (isNativePlatform()) {
      try { plugin = await (await import('../native/runtime')).getLocalNotificationsPlugin() } catch { plugin = null }
    }
    scheduler = createSnoozeScheduler({
      plugin,
      showWeb: showWebNotification,
      labels: { doIt: tr('DO IT'), snooze: tr('REMIND ME AFTER 5M') },
      onFire: async () => { await wakeAndPresent() },
    })
    return scheduler
  })()
  return schedulerPromise
}

/** Asks the database which snoozes are over and shows each one once. The database clears snoozed_until, so repeats return nothing. */
export async function wakeAndPresent() {
  const s = await getSnoozeScheduler()
  const rows = await wakeDueNotifications()
  for (const n of rows) {
    await s.cancel(n.id)
    await s.present(n).catch(() => {})
  }
  return rows
}

/** Re-creates device alerts for notifications that are still snoozed (app start, resume, coming back online). */
export async function restoreSnoozes() {
  const s = await getSnoozeScheduler()
  return s.reconcile(await pendingSnoozes())
}

/**
 * DO IT and REMIND ME AFTER 5M for any screen. `confirm` is non-null while a sensitive action waits for the user's OK.
 * `onResult(n, outcome)` lets the screen patch its list.
 */
export function useSmartActions({ onResult, navigate } = {}) {
  const [busy, setBusy] = useState(null) // `${id}:${action}`
  const [confirm, setConfirm] = useState(null)
  const [message, setMessage] = useState(null)
  const inFlight = useRef(new Set()) // blocks a second tap while the first is still running (the database blocks it too)

  const execute = useCallback(async (n) => {
    const k = `${n.id}:do`
    if (inFlight.current.has(k)) return
    inFlight.current.add(k)
    setBusy(k)
    setMessage(null)
    try {
      const res = await runDoIt(n)
      onResult?.(n, { type: 'done', ...res })
      if (res.status === 'duplicate') setMessage({ id: n.id, text: tr('Already handled.') })
      else if (!n.action_kind || n.action_kind === 'open') { if (res.link && navigate) navigate(res.link) }
      else setMessage({ id: n.id, text: tr('Done.'), link: res.link })
    } catch (e) {
      setMessage({ id: n.id, text: friendlyError(e), error: true })
    } finally {
      inFlight.current.delete(k)
      setBusy(null)
    }
  }, [onResult, navigate])

  const doIt = useCallback((n) => {
    if (requiresConfirm(n.action_kind)) setConfirm(n)
    else execute(n)
  }, [execute])

  const snooze = useCallback(async (n) => {
    const k = `${n.id}:snooze`
    if (inFlight.current.has(k)) return
    inFlight.current.add(k)
    setBusy(k)
    setMessage(null)
    try {
      const res = await snoozeNotification(n)
      if (res?.snoozed) {
        await (await getSnoozeScheduler()).schedule(n, res.snoozed_until)
        onResult?.(n, { type: 'snoozed', snoozed_until: res.snoozed_until })
        setMessage({ id: n.id, text: tr('We will remind you in 5 minutes.') })
      } else setMessage({ id: n.id, text: tr('Already handled.') })
    } catch (e) {
      setMessage({ id: n.id, text: friendlyError(e), error: true })
    } finally {
      inFlight.current.delete(k)
      setBusy(null)
    }
  }, [onResult])

  return { doIt, snooze, execute, busy, confirm, closeConfirm: () => setConfirm(null), message }
}

/** Keeps snoozes honest while the app is open: wakes due ones every 30 s, on resume and when the connection returns, and restores alerts at start. */
export function useSnoozeLoop(enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined
    const run = () => wakeAndPresent().catch(() => {})
    restoreSnoozes().catch(() => {})
    run()
    const id = setInterval(run, 30000)
    const onVisible = () => { if (document.visibilityState === 'visible') { run(); restoreSnoozes().catch(() => {}) } }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', run)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', run) }
  }, [enabled])
}

/** The service worker tells the open app which web-notification button was pressed (see public/sw-actions.js). */
export function useNotificationActionMessages(navigate) {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return undefined
    const onMessage = (event) => {
      const d = event.data
      if (d?.type !== 'life-os:notification-action' || !isUuid(d.notificationId)) return
      const act = d.action === 'do' || d.action === 'snooze' ? d.action : null
      navigate(`/notifications?${act ? `act=${act}&` : ''}n=${d.notificationId}`)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [navigate])
}
