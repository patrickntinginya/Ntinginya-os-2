// Android-only singletons. Imported by screens that need them, but nothing here runs on the web:
//  - the repository only works when the Reminders screen calls it (which it does only when isNativePlatform() is true)
//  - Capacitor plugins are loaded with dynamic import(), so the web build never loads them
import { db } from '../services/db'
import { supabase } from '../lib/supabase'
import { tr } from '../i18n'
import { createIdbStorage } from '../services/offlineStorage'
import { createDbRemote, createReminderAdapter, createReminderRepository } from '../services/reminderSync'
import { createReminderNotifier } from './localNotifications'
import { createReminderCoordinator } from './reminderCoordinator'

export const repository = createReminderRepository({
  storage: createIdbStorage(),
  remote: createDbRemote(db),
  resolveUser: async () => (await supabase.auth.getSession()).data.session?.user?.id,
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
})
export const reminderAdapter = createReminderAdapter(repository)

let notifierPromise = null
export function getNotifier() {
  notifierPromise ||= import('@capacitor/local-notifications').then(({ LocalNotifications }) =>
    createReminderNotifier({
      plugin: LocalNotifications,
      labels: {
        channelName: tr('Reminders'),
        channelDescription: tr('Alerts for your reminders'),
        defaultBody: tr('Reminder'),
        testTitle: 'Personal Life OS',
        testBody: tr('Test notification: Android notifications are working.'),
      },
    }),
  )
  return notifierPromise
}

let coordinatorPromise = null
export function getCoordinator() {
  coordinatorPromise ||= getNotifier().then((notifier) => createReminderCoordinator({ repo: repository, notifier }))
  return coordinatorPromise
}

/** Called before sign-out: try to send waiting changes (bounded wait). */
export const beforeSignOut = () => repository.flush(4000)
/** Called when the account is deleted: remove everything this user left on the phone. */
export async function purgeLocalUserData(userId) {
  if (!userId) return
  await (await getCoordinator()).userLeft(null).catch(() => {})
  await repository.purgeUser(userId)
}
