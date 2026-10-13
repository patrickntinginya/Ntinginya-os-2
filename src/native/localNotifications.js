// Schedules reminder alarms on Android through the Capacitor Local Notifications plugin.
// The plugin object is injected, so this file imports nothing native and is unit-tested with a fake plugin.
// Android keeps the alarms, so they can fire while the app is closed and the phone has no internet.
// HONEST LIMITS: exact timing is not guaranteed on every phone (Doze, battery savers and manufacturer task killers can delay
// or drop alarms, and Android 12+ needs the user to allow "exact" alarms). Verify on real devices. See docs/ANDROID_BUILD.md.
import { ID_START, isReminderNotificationId, planSchedule } from '../lib/reminderSchedule.js'
import { isUuid } from '../lib/uuid.js'

export const CHANNEL_ID = 'reminders'
export const TEST_NOTIFICATION_ID = ID_START - 1 // outside the reminder id range, so a reschedule never cancels it
export const REMINDERS_ROUTE = '/reminders'

/** Only a fixed, known screen can be opened from a notification. The reminder id is validated, never trusted as a path. */
export const routeForNotification = (extra) => (isUuid(extra?.reminderId) ? `${REMINDERS_ROUTE}?focus=${extra.reminderId}` : REMINDERS_ROUTE)

export function createReminderNotifier({ plugin, now = () => new Date(), labels = {} }) {
  const L = { channelName: 'Reminders', channelDescription: 'Reminder alerts', defaultBody: 'Reminder', testTitle: 'Personal Life OS', testBody: 'Test notification', ...labels }
  let channelReady = false

  const permission = async () => {
    try {
      return (await plugin.checkPermissions()).display
    } catch {
      return 'unsupported'
    }
  }

  async function ensureChannel() {
    if (channelReady) return
    try {
      await plugin.createChannel({ id: CHANNEL_ID, name: L.channelName, description: L.channelDescription, importance: 4, visibility: 1, vibration: true })
    } catch {
      /* not Android, or the channel already exists: harmless */
    }
    channelReady = true
  }

  async function pendingOurs() {
    try {
      return ((await plugin.getPending()).notifications || []).filter((n) => isReminderNotificationId(n.id))
    } catch {
      return []
    }
  }

  async function cancelIds(ids) {
    if (ids.length) await plugin.cancel({ notifications: ids.map((id) => ({ id })) })
  }

  return {
    permission,
    /** Asks Android for notification permission. Call this only from a user action (Android 13+ shows a system dialog). */
    async requestPermission() {
      try {
        return (await plugin.requestPermissions()).display
      } catch {
        return 'unsupported'
      }
    },
    /** 'granted' | 'denied' | 'prompt' | 'unknown'. Android 12+ may deny exact alarms by default. */
    async exactAlarmState() {
      try {
        return (await plugin.checkExactNotificationSetting?.())?.exact_alarm ?? 'unknown'
      } catch {
        return 'unknown'
      }
    },
    async openExactAlarmSettings() {
      try {
        await plugin.changeExactNotificationSetting?.()
      } catch {
        /* older Android: nothing to open */
      }
    },

    /**
     * Makes Android's pending reminder alarms match `reminders` exactly: stale ones are cancelled, wanted ones are
     * (re)scheduled with stable ids, so running this twice never creates duplicates.
     * Returns { scheduled, cancelled, reason? }. Never throws for permission problems.
     */
    async reconcile(reminders) {
      const perm = await permission()
      if (perm !== 'granted') {
        await cancelIds((await pendingOurs()).map((n) => n.id)).catch(() => {})
        return { scheduled: 0, cancelled: 0, reason: 'permission_denied', permission: perm }
      }
      await ensureChannel()
      const plan = planSchedule(reminders, now())
      const pending = await pendingOurs()
      // Cancel stale alarms AND the ones about to be re-created, so a re-schedule can never leave a duplicate behind.
      const toCancel = pending.map((n) => n.id)
      await cancelIds(toCancel)
      const byId = new Map((reminders || []).map((r) => [r.id, r]))
      if (plan.length) {
        await plugin.schedule({
          notifications: plan.map((p) => {
            const r = byId.get(p.reminderId)
            return {
              id: p.id,
              title: String(r.title).slice(0, 120),
              body: r.description ? String(r.description).slice(0, 240) : L.defaultBody,
              schedule: { at: p.at, allowWhileIdle: true },
              channelId: CHANNEL_ID,
              extra: { reminderId: p.reminderId, kind: 'reminder' },
            }
          }),
        })
      }
      return { scheduled: plan.length, cancelled: toCancel.length }
    },

    async cancelAll() {
      await cancelIds((await pendingOurs()).map((n) => n.id))
    },

    /** One notification a few seconds from now, for the "Send a test notification" button. */
    async scheduleTest(seconds = 5) {
      if ((await permission()) !== 'granted') return { ok: false, reason: 'permission_denied' }
      await ensureChannel()
      await plugin.schedule({
        notifications: [{ id: TEST_NOTIFICATION_ID, title: L.testTitle, body: L.testBody, schedule: { at: new Date(now().getTime() + seconds * 1000), allowWhileIdle: true }, channelId: CHANNEL_ID, extra: { kind: 'test' } }],
      })
      return { ok: true }
    },

    /** Calls handler(route) when the user taps a notification. Resolves to a handle with remove(). */
    async onTap(handler) {
      return plugin.addListener('localNotificationActionPerformed', (event) => handler(routeForNotification(event?.notification?.extra)))
    },
  }
}
