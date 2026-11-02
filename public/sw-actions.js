// Loaded by the generated service worker (workbox.importScripts). Handles the DO IT / REMIND ME AFTER 5M buttons on web notifications.
// A service worker has no Supabase session, so it never changes data itself: it opens/focuses the app and tells it which action was pressed.
// The app performs the action through the database functions (which are idempotent), so a repeated click cannot run twice.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {}
  const id = data.notificationId
  event.notification.close()
  if (typeof id !== 'string' || !UUID.test(id)) return
  const action = event.action === 'do' || event.action === 'snooze' ? event.action : 'open'
  const url = '/notifications?' + (action === 'open' ? '' : 'act=' + action + '&') + 'n=' + encodeURIComponent(id)
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus()
        client.postMessage({ type: 'life-os:notification-action', action, notificationId: id })
        return
      }
    }
    await self.clients.openWindow(url)
  })())
})
