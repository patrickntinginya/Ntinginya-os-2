// Minimal in-memory IndexedDB for unit tests (Node has none and no package can be installed offline).
// Models what the app's storage code relies on: versioned upgrade, keyPath stores, indexes with getAll(value),
// transactions that commit only when no requests remain, rollback on abort, structured-clone isolation, and
// persistence across separate open() calls (to simulate an app restart). It is NOT a substitute for a real browser.
export function createFakeIndexedDB() {
  const databases = new Map()
  const clone = (v) => (v === undefined ? v : structuredClone(v))
  const api = {
    failWhen: null, // (storeName, operation) => boolean, to inject a request failure
    open(name, version) {
      const request = {}
      setTimeout(() => {
        let rec = databases.get(name)
        const oldVersion = rec ? rec.version : 0
        if (!rec) databases.set(name, (rec = { version: 0, stores: new Map() }))
        const db = makeDb(rec, api)
        request.result = db
        if (version > oldVersion) {
          db.upgrading = true
          request.onupgradeneeded?.({ oldVersion, newVersion: version })
          db.upgrading = false
          rec.version = version
        }
        request.onsuccess?.()
      }, 0)
      return request
    },
    dump(name) {
      const rec = databases.get(name)
      return rec ? Object.fromEntries([...rec.stores].map(([n, s]) => [n, [...s.data.values()].map(clone)])) : null
    },
    storeNames(name) {
      const rec = databases.get(name)
      return rec ? [...rec.stores.keys()] : []
    },
  }

  function makeDb(rec, root) {
    const db = {
      upgrading: false,
      objectStoreNames: { contains: (n) => rec.stores.has(n) },
      createObjectStore(name, { keyPath }) {
        const store = { keyPath, data: new Map(), indexes: new Map() }
        rec.stores.set(name, store)
        return { createIndex: (iname, path) => store.indexes.set(iname, path) }
      },
      deleteObjectStore: (name) => rec.stores.delete(name),
      transaction(names, mode) {
        names = Array.isArray(names) ? names : [names]
        return makeTx(rec, names, mode, root)
      },
    }
    return db
  }

  function makeTx(rec, names, mode, root) {
    const tx = { error: null, oncomplete: null, onerror: null, onabort: null }
    let pending = 0
    let finished = false
    const backup = new Map()
    const finishCheck = () =>
      setTimeout(() => {
        if (finished || pending > 0) return
        finished = true
        tx.oncomplete?.()
      }, 0)
    const abort = (error) => {
      if (finished) return
      finished = true
      tx.error = error || null
      for (const [n, data] of backup) rec.stores.get(n).data = data
      tx.onabort?.()
    }
    tx.abort = () => abort(null)
    finishCheck()

    const request = (storeName, op, fn) => {
      const req = {}
      pending++
      setTimeout(() => {
        if (finished) return
        try {
          if (root.failWhen?.(storeName, op)) throw new Error(`injected failure on ${storeName}.${op}`)
          if (op !== 'read' && mode === 'readonly') throw new Error('write in a readonly transaction')
          if (op !== 'read' && !backup.has(storeName)) backup.set(storeName, new Map(rec.stores.get(storeName).data))
          req.result = fn()
        } catch (e) {
          pending--
          req.error = e
          req.onerror?.()
          abort(e)
          tx.onerror?.()
          return
        }
        pending--
        req.onsuccess?.()
        finishCheck()
      }, 0)
      return req
    }

    tx.objectStore = (storeName) => {
      if (!names.includes(storeName)) throw new Error(`store ${storeName} not in transaction`)
      const store = rec.stores.get(storeName)
      const keyOf = (value) => value[store.keyPath]
      return {
        put: (value) => request(storeName, 'write', () => (store.data.set(keyOf(value), clone(value)), keyOf(value))),
        add: (value) =>
          request(storeName, 'write', () => {
            if (store.data.has(keyOf(value))) throw new Error('ConstraintError')
            store.data.set(keyOf(value), clone(value))
            return keyOf(value)
          }),
        get: (key) => request(storeName, 'read', () => clone(store.data.get(key))),
        delete: (key) => request(storeName, 'write', () => void store.data.delete(key)),
        getAll: () => request(storeName, 'read', () => [...store.data.values()].map(clone)),
        index: (iname) => ({
          getAll: (value) =>
            request(storeName, 'read', () => {
              const path = store.indexes.get(iname)
              return [...store.data.values()].filter((r) => r[path] === value).map(clone)
            }),
        }),
      }
    }
    return tx
  }
  return api
}
