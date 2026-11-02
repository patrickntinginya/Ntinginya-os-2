/**
 * IndexedDB storage for offline reminders (Android app). Rewritten in Phase 2; the first version was never connected to the app.
 *
 * Layout (database 'life-os-offline', version 2):
 *   rows  - the last copy of each reminder seen from the server.   key pk = `${userId}:${reminderId}`
 *   ops   - ONE pending change per reminder (create | update | delete). key pk = `${userId}:${reminderId}`
 *   meta  - small per-user values.                                   key = `${userId}:${name}`
 *
 * Every record carries its user_id and every read is by user, so one account can never see another account's local data.
 * Every call resolves only when its IndexedDB TRANSACTION COMPLETES (not when a request fires), so "saved" means committed.
 * Version 1 stores ('reminders', 'mutations') were never populated by any released code; the upgrade removes them.
 */
export const DB_NAME = 'life-os-offline'
export const DB_VERSION = 2

export const isIndexedDBAvailable = () => {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

const reqP = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

function openDb(factory) {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (event) => {
      const database = request.result
      for (const old of ['reminders', 'mutations']) if (database.objectStoreNames.contains(old)) database.deleteObjectStore(old)
      if (!database.objectStoreNames.contains('rows')) database.createObjectStore('rows', { keyPath: 'pk' }).createIndex('user_id', 'user_id', { unique: false })
      if (!database.objectStoreNames.contains('ops')) database.createObjectStore('ops', { keyPath: 'pk' }).createIndex('user_id', 'user_id', { unique: false })
      if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta', { keyPath: 'key' })
      void event
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Offline storage is blocked by another open tab'))
  })
}

/** Runs `fn(stores)` inside one transaction; resolves with fn's result once the transaction has COMMITTED. */
function run(database, names, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(names, mode)
    let result
    let failed = false
    tx.oncomplete = () => (failed ? undefined : resolve(result))
    tx.onerror = () => {
      failed = true
      reject(tx.error || new Error('Offline storage transaction failed'))
    }
    tx.onabort = () => {
      failed = true
      reject(tx.error || new Error('Offline storage transaction aborted'))
    }
    const stores = Object.fromEntries(names.map((n) => [n, tx.objectStore(n)]))
    Promise.resolve()
      .then(() => fn(stores))
      .then(
        (r) => {
          result = r
        },
        (e) => {
          failed = true
          try {
            tx.abort()
          } catch {
            /* already finished */
          }
          reject(e)
        },
      )
  })
}

const pk = (userId, id) => `${userId}:${id}`

/** Creates the storage object. `factory` is injectable so tests can use an in-memory IndexedDB. */
export function createIdbStorage(factory = globalThis.indexedDB) {
  let dbPromise = null
  const database = () => (dbPromise ||= openDb(factory).catch((e) => {
    dbPromise = null
    throw e
  }))
  const tx = async (names, mode, fn) => run(await database(), names, mode, fn)

  const need = (userId) => {
    if (!userId) throw new Error('Offline storage needs a signed-in user')
    return String(userId)
  }

  return {
    // ---- cached server rows ----
    async getSnapshot(userId) {
      const uid = need(userId)
      const records = await tx(['rows'], 'readonly', ({ rows }) => reqP(rows.index('user_id').getAll(uid)))
      return records.filter((r) => r.user_id === uid).map((r) => r.data)
    },
    async getRow(userId, id) {
      const uid = need(userId)
      const rec = await tx(['rows'], 'readonly', ({ rows }) => reqP(rows.get(pk(uid, id))))
      return rec && rec.user_id === uid ? rec.data : null
    },
    async putRow(userId, row) {
      const uid = need(userId)
      await tx(['rows'], 'readwrite', ({ rows }) => reqP(rows.put({ pk: pk(uid, row.id), user_id: uid, id: row.id, data: row })))
    },
    async deleteRow(userId, id) {
      const uid = need(userId)
      await tx(['rows'], 'readwrite', ({ rows }) => reqP(rows.delete(pk(uid, id))))
    },
    /** Replaces this user's cached rows with a fresh server list, atomically (all or nothing). */
    async replaceSnapshot(userId, list) {
      const uid = need(userId)
      await tx(['rows', 'meta'], 'readwrite', async ({ rows, meta }) => {
        const existing = await reqP(rows.index('user_id').getAll(uid))
        for (const rec of existing) if (rec.user_id === uid) await reqP(rows.delete(rec.pk))
        for (const row of list) await reqP(rows.put({ pk: pk(uid, row.id), user_id: uid, id: row.id, data: row }))
        await reqP(meta.put({ key: `${uid}:snapshot_at`, value: Date.now() }))
      })
    },

    // ---- pending changes (one per reminder) ----
    async getOp(userId, reminderId) {
      const uid = need(userId)
      const op = await tx(['ops'], 'readonly', ({ ops }) => reqP(ops.get(pk(uid, reminderId))))
      return op && op.user_id === uid ? op : null
    },
    async putOp(userId, op) {
      const uid = need(userId)
      await tx(['ops'], 'readwrite', ({ ops }) => reqP(ops.put({ ...op, pk: pk(uid, op.reminder_id), user_id: uid })))
    },
    async deleteOp(userId, reminderId) {
      const uid = need(userId)
      await tx(['ops'], 'readwrite', ({ ops }) => reqP(ops.delete(pk(uid, reminderId))))
    },
    async listOps(userId) {
      const uid = need(userId)
      const all = await tx(['ops'], 'readonly', ({ ops }) => reqP(ops.index('user_id').getAll(uid)))
      return all.filter((o) => o.user_id === uid).sort((a, b) => (a.queued_at - b.queued_at) || (a.reminder_id < b.reminder_id ? -1 : 1))
    },

    // ---- meta + cleanup ----
    async getMeta(userId, name) {
      const uid = need(userId)
      const rec = await tx(['meta'], 'readonly', ({ meta }) => reqP(meta.get(`${uid}:${name}`)))
      return rec ? rec.value : null
    },
    async setMeta(userId, name, value) {
      const uid = need(userId)
      await tx(['meta'], 'readwrite', ({ meta }) => reqP(meta.put({ key: `${uid}:${name}`, value })))
    },
    /**
     * Removes ONE user's local data. Never touches another user's records.
     * keepOps: keep that user's unsynced changes (used on sign-out so nothing is lost; they sync when that user signs in again).
     */
    async clearUser(userId, { keepOps = false } = {}) {
      const uid = need(userId)
      await tx(['rows', 'ops', 'meta'], 'readwrite', async ({ rows, ops, meta }) => {
        for (const rec of await reqP(rows.index('user_id').getAll(uid))) if (rec.user_id === uid) await reqP(rows.delete(rec.pk))
        if (!keepOps) for (const rec of await reqP(ops.index('user_id').getAll(uid))) if (rec.user_id === uid) await reqP(ops.delete(rec.pk))
        await reqP(meta.delete(`${uid}:snapshot_at`))
      })
    },
  }
}
