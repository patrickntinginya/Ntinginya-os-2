// Decides WHEN reminder alarms are rebuilt, and from WHAT data. Runs after: app start, app resume, connection returns,
// any reminder change, and each sync. Calls are serialized and coalesced: if several triggers arrive while one run is in
// progress, exactly one more run follows with the latest settings.
//  - Online: refresh the local copy from Supabase first, so changes made on the website are picked up.
//  - Offline: schedule from the local copy (cached rows + unsynced changes), so alarms still match what the user sees.
export function createReminderCoordinator({ repo, notifier }) {
  let current = null
  let again = false
  let latest = null

  async function once({ enabled }) {
    if (!enabled) {
      await notifier.cancelAll()
      return { scheduled: 0, cancelled: 0, reason: 'disabled' }
    }
    await repo.refresh().catch(() => false)
    return notifier.reconcile(await repo.readLocal())
  }

  function run(args) {
    latest = args
    if (current) {
      again = true
      return current
    }
    current = (async () => {
      try {
        let result
        do {
          again = false
          result = await once(latest)
        } while (again)
        return result
      } finally {
        current = null
      }
    })()
    return current
  }

  return {
    run,
    /** Another account took over (or the user signed out): remove this phone's alarms for the old one and its cached copy. */
    async userLeft(userId) {
      await notifier.cancelAll()
      if (userId) await repo.leaveUser(userId)
    },
  }
}
