// IndexedDB storage for downloaded media. One database PER USER, so another account on the same device can never open these files.
// Two object stores: "meta" (small records, keyed by media id) and "blobs" (the files). Everything is promise based; errors reject.
const STORES = { meta: 'meta', blobs: 'blobs' }
const name = (userId, prefix = 'ntinginya-offline-media') => `${prefix}-${String(userId).replace(/[^a-zA-Z0-9-]/g, '')}`

export const offlineSupported = () => typeof indexedDB !== 'undefined' && indexedDB !== null

function open(userId, prefix) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name(userId, prefix), 1)
    req.onupgradeneeded = () => { const db = req.result; db.createObjectStore(STORES.meta, { keyPath: 'id' }); db.createObjectStore(STORES.blobs) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function createIndexedDbStore(userId, prefix = 'ntinginya-offline-media') {
  let dbp = null
  const db = () => (dbp ||= open(userId, prefix))
  const tx = async (store, mode, fn) => {
    const d = await db()
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode)
      const req = fn(t.objectStore(store))
      let result
      if (req) req.onsuccess = () => { result = req.result }
      t.oncomplete = () => resolve(result)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error || new Error('aborted'))
    })
  }
  return {
    listMeta: () => tx(STORES.meta, 'readonly', (s) => s.getAll()).then((r) => r || []),
    getMeta: (id) => tx(STORES.meta, 'readonly', (s) => s.get(id)).then((r) => r || null),
    putMeta: (m) => tx(STORES.meta, 'readwrite', (s) => s.put(m)),
    deleteMeta: (id) => tx(STORES.meta, 'readwrite', (s) => s.delete(id)),
    putBlob: (id, blob) => tx(STORES.blobs, 'readwrite', (s) => s.put(blob, id)),
    getBlob: (id) => tx(STORES.blobs, 'readonly', (s) => s.get(id)).then((r) => r || null),
    hasBlob: (id) => tx(STORES.blobs, 'readonly', (s) => s.count(id)).then((n) => n > 0),
    deleteBlob: (id) => tx(STORES.blobs, 'readwrite', (s) => s.delete(id)),
    listBlobIds: () => tx(STORES.blobs, 'readonly', (s) => s.getAllKeys()).then((r) => r || []),
  }
}

/** Asks the browser not to evict our files under storage pressure. Best effort; returns true/false/null (unsupported). */
export async function requestPersistence() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : null } catch { return null }
}
export async function storageEstimate() {
  try { return navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null } catch { return null }
}
