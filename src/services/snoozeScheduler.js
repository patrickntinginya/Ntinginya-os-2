// Puts a snoozed notification back in front of the user after the five minutes, on the device.
// The DATABASE is the source of truth (notifications.snoozed_until, set by the server clock). This file only makes the device
// speak up at the right moment. When the device cannot (browser closed, no push server), the notification still comes back the
// next time the app is opened, because notification_wake_due() runs at start-up and on resume.
//
// Native (Android, Capacitor Local Notifications): an OS alarm with a stable id, so scheduling twice REPLACES the first alarm.
//   Android keeps these alarms across app closure; the plugin re-registers them after a reboot. Doze or battery savers may delay them.
// Web: a timer that only lives while the app/PWA is open or running in the background. HONEST LIMIT: a closed browser cannot be woken
//   without a push server, which this version does not have.
import { ACTION_IDS, snoozeAlarmId } from '../utils/smartActions.js'

export const SMART_ACTION_TYPE = 'SMART_ACTION'
export const SMART_CHANNEL = 'reminders'

export function createSnoozeScheduler({ plugin = null, showWeb = null, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, onFire = async () => {}, labels = {} } = {}) {
  const L = { doIt: 'DO IT', snooze: 'REMIND ME AFTER 5M', channelName: 'Reminders', channelDescription: 'Reminder alerts', ...labels }
  const timers = new Map()
  let nativeReady = false

  // The channel and the two buttons must exist BEFORE the first snooze alarm is scheduled, even if no reminder was scheduled in this
  // session (Android 8+ needs the channel; the action type is what puts DO IT / REMIND ME AFTER 5M on the notification). Both calls are idempotent.
  async function ensureNative() {
    if (nativeReady) return
    await plugin.createChannel?.({ id: SMART_CHANNEL, name: L.channelName, description: L.channelDescription, importance: 4, visibility: 1, vibration: true }).catch(() => {})
    await plugin.registerActionTypes?.({ types: [{ id: SMART_ACTION_TYPE, actions: [{ id: ACTION_IDS.doIt, title: L.doIt, foreground: true }, { id: ACTION_IDS.snooze, title: L.snooze, foreground: true }] }] }).catch(() => {})
    nativeReady = true
  }

  async function scheduleNative(n, atMs) {
    await ensureNative()
    const id = snoozeAlarmId(n.id)
    await plugin.cancel({ notifications: [{ id }] }).catch(() => {})
    await plugin.schedule({
      notifications: [{
        id,
        title: String(n.title || '').slice(0, 120),
        body: n.body ? String(n.body).slice(0, 240) : '',
        schedule: { at: new Date(atMs), allowWhileIdle: true },
        channelId: SMART_CHANNEL,
        actionTypeId: SMART_ACTION_TYPE,
        extra: { kind: 'smart', notificationId: n.id },
      }],
    })
  }

  function scheduleWeb(n, atMs) {
    clearTimer(timers.get(n.id))
    const delay = Math.max(0, atMs - now())
    const handle = setTimer(async () => {
      timers.delete(n.id)
      await onFire(n.id)
    }, delay)
    timers.set(n.id, handle)
  }

  return {
    /** Schedules (or re-schedules) ONE device alert for a snoozed notification. Calling it twice never leaves two alerts. */
    async schedule(n, snoozedUntilISO) {
      const atMs = new Date(snoozedUntilISO).getTime()
      if (!Number.isFinite(atMs)) return { scheduled: false, reason: 'bad_time' }
      if (plugin) {
        await scheduleNative(n, atMs)
        return { scheduled: true, via: 'native' }
      }
      scheduleWeb(n, atMs)
      return { scheduled: true, via: 'web' }
    },
    async cancel(notificationId) {
      clearTimer(timers.get(notificationId))
      timers.delete(notificationId)
      if (plugin) await plugin.cancel({ notifications: [{ id: snoozeAlarmId(notificationId) }] }).catch(() => {})
    },
    /** Rebuilds alerts for every notification that is still snoozed (after a restart or reopening the app). Idempotent. */
    async reconcile(rows) {
      let count = 0
      for (const n of rows || []) {
        if (n.snoozed_until && new Date(n.snoozed_until).getTime() > now()) {
          const r = await this.schedule(n, n.snoozed_until)
          if (r.scheduled) count += 1
        }
      }
      return count
    },
    /** Shows the alert for a notification that just woke up (web). On Android the OS alarm already showed it. */
    async present(n) {
      if (plugin || !showWeb) return false
      await showWeb(n, { actions: [{ action: ACTION_IDS.doIt, title: L.doIt }, { action: ACTION_IDS.snooze, title: L.snooze }] })
      return true
    },
    pendingTimers: () => timers.size,
  }
}

/** Browser alert. Uses the service worker when there is one (the only way to get action buttons); the same `tag` replaces an older alert. */
export async function showWebNotification(n, { actions = [] } = {}) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false
  const options = { body: n.body || '', tag: `ntg-${n.id}`, renotify: true, icon: '/pwa-192.png', badge: '/pwa-192.png', data: { notificationId: n.id }, actions }
  const reg = await navigator.serviceWorker?.getRegistration()
  if (reg) await reg.showNotification(n.title, options)
  else new Notification(n.title, { body: options.body, tag: options.tag, icon: options.icon, data: options.data })
  return true
}
