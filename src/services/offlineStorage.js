/**
 * IndexedDB wrapper for offline-first local storage.
 * Stores reminders and a mutation queue for changes made while offline.
 */

const DB_NAME = 'life-os-offline'
const DB_VERSION = 1
const REMINDERS_STORE = 'reminders'
const MUTATIONS_STORE = 'mutations'

let db = null

export async function initOfflineStorage() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      db = request.result
      resolve(db)
    }

    request.onupgradeneeded = (event) => {
      const database = event.target.result
      
      // Reminders store: keyed by local ID, indexed by server ID and sync status
      if (!database.objectStoreNames.contains(REMINDERS_STORE)) {
        const remindersStore = database.createObjectStore(REMINDERS_STORE, { keyPath: 'local_id' })
        remindersStore.createIndex('server_id', 'server_id', { unique: false })
        remindersStore.createIndex('sync_status', 'sync_status', { unique: false })
        remindersStore.createIndex('user_id', 'user_id', { unique: false })
      }

      // Mutations store: changes queued for sync
      // Each mutation has: id, user_id, type (create/update/complete/delete), table, reminder_id, data, created_at, synced_at
      if (!database.objectStoreNames.contains(MUTATIONS_STORE)) {
        const mutationsStore = database.createObjectStore(MUTATIONS_STORE, { keyPath: 'id', autoIncrement: true })
        mutationsStore.createIndex('user_id', 'user_id', { unique: false })
        mutationsStore.createIndex('synced_at', 'synced_at', { unique: false })
      }
    }
  })
}

function getDb() {
  if (!db) throw new Error('Offline storage not initialized. Call initOfflineStorage() first.')
  return db
}

// ============================================================================
// REMINDERS STORE OPERATIONS
// ============================================================================

export async function saveReminderLocally(reminder, userId, syncStatus = 'unsynced') {
  const database = getDb()
  const store = database.transaction([REMINDERS_STORE], 'readwrite').objectStore(REMINDERS_STORE)
  
  const record = {
    local_id: reminder.local_id || `local_${Date.now()}_${Math.random()}`,
    server_id: reminder.id || null,
    user_id: userId,
    sync_status: syncStatus, // 'unsynced', 'syncing', 'synced', 'failed'
    data: reminder,
    updated_at: new Date().toISOString(),
  }

  return new Promise((resolve, reject) => {
    const request = store.put(record)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(record.local_id)
  })
}

export async function getRemindersLocally(userId) {
  const database = getDb()
  const store = database.transaction([REMINDERS_STORE], 'readonly').objectStore(REMINDERS_STORE)
  const index = store.index('user_id')

  return new Promise((resolve, reject) => {
    const request = index.getAll(userId)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const records = request.result
      // Return both server and local data, merged
      const reminders = records.map((r) => ({
        ...r.data,
        local_id: r.local_id,
        sync_status: r.sync_status,
        _updated_at: r.updated_at,
      }))
      resolve(reminders)
    }
  })
}

export async function getLocalReminderById(localId) {
  const database = getDb()
  const store = database.transaction([REMINDERS_STORE], 'readonly').objectStore(REMINDERS_STORE)

  return new Promise((resolve, reject) => {
    const request = store.get(localId)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const record = request.result
      resolve(record ? { ...record.data, local_id: record.local_id, sync_status: record.sync_status } : null)
    }
  })
}

export async function deleteReminderLocally(localId) {
  const database = getDb()
  const store = database.transaction([REMINDERS_STORE], 'readwrite').objectStore(REMINDERS_STORE)

  return new Promise((resolve, reject) => {
    const request = store.delete(localId)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

export async function updateReminderSyncStatus(localId, syncStatus) {
  const database = getDb()
  const store = database.transaction([REMINDERS_STORE], 'readwrite').objectStore(REMINDERS_STORE)

  return new Promise((resolve, reject) => {
    const getRequest = store.get(localId)
    getRequest.onerror = () => reject(getRequest.error)
    getRequest.onsuccess = () => {
      const record = getRequest.result
      if (!record) {
        reject(new Error(`Reminder not found: ${localId}`))
        return
      }
      record.sync_status = syncStatus
      record.updated_at = new Date().toISOString()
      const putRequest = store.put(record)
      putRequest.onerror = () => reject(putRequest.error)
      putRequest.onsuccess = () => resolve()
    }
  })
}

export async function linkLocalReminderToServer(localId, serverId) {
  const database = getDb()
  const store = database.transaction([REMINDERS_STORE], 'readwrite').objectStore(REMINDERS_STORE)

  return new Promise((resolve, reject) => {
    const getRequest = store.get(localId)
    getRequest.onerror = () => reject(getRequest.error)
    getRequest.onsuccess = () => {
      const record = getRequest.result
      if (!record) {
        reject(new Error(`Reminder not found: ${localId}`))
        return
      }
      record.server_id = serverId
      record.data.id = serverId
      record.sync_status = 'synced'
      record.updated_at = new Date().toISOString()
      const putRequest = store.put(record)
      putRequest.onerror = () => reject(putRequest.error)
      putRequest.onsuccess = () => resolve()
    }
  })
}

// ============================================================================
// MUTATIONS STORE OPERATIONS
// ============================================================================

export async function queueMutation(userId, type, table, reminderId, data) {
  const database = getDb()
  const store = database.transaction([MUTATIONS_STORE], 'readwrite').objectStore(MUTATIONS_STORE)

  const mutation = {
    user_id: userId,
    type, // 'create', 'update', 'complete', 'delete'
    table,
    reminder_id: reminderId,
    data,
    created_at: new Date().toISOString(),
    synced_at: null,
    retry_count: 0,
  }

  return new Promise((resolve, reject) => {
    const request = store.add(mutation)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

export async function getPendingMutations(userId) {
  const database = getDb()
  const store = database.transaction([MUTATIONS_STORE], 'readonly').objectStore(MUTATIONS_STORE)
  const index = store.index('user_id')

  return new Promise((resolve, reject) => {
    const request = index.getAll(userId)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const mutations = request.result.filter((m) => !m.synced_at)
      resolve(mutations)
    }
  })
}

export async function markMutationSynced(mutationId, serverId = null) {
  const database = getDb()
  const store = database.transaction([MUTATIONS_STORE], 'readwrite').objectStore(MUTATIONS_STORE)

  return new Promise((resolve, reject) => {
    const getRequest = store.get(mutationId)
    getRequest.onerror = () => reject(getRequest.error)
    getRequest.onsuccess = () => {
      const mutation = getRequest.result
      if (!mutation) {
        reject(new Error(`Mutation not found: ${mutationId}`))
        return
      }
      mutation.synced_at = new Date().toISOString()
      if (serverId) mutation.server_id = serverId
      const putRequest = store.put(mutation)
      putRequest.onerror = () => reject(putRequest.error)
      putRequest.onsuccess = () => resolve()
    }
  })
}

export async function incrementMutationRetry(mutationId) {
  const database = getDb()
  const store = database.transaction([MUTATIONS_STORE], 'readwrite').objectStore(MUTATIONS_STORE)

  return new Promise((resolve, reject) => {
    const getRequest = store.get(mutationId)
    getRequest.onerror = () => reject(getRequest.error)
    getRequest.onsuccess = () => {
      const mutation = getRequest.result
      if (!mutation) {
        reject(new Error(`Mutation not found: ${mutationId}`))
        return
      }
      mutation.retry_count = (mutation.retry_count || 0) + 1
      const putRequest = store.put(mutation)
      putRequest.onerror = () => reject(putRequest.error)
      putRequest.onsuccess = () => resolve(mutation.retry_count)
    }
  })
}

export async function clearMutationsBefore(isoDate, userId) {
  const database = getDb()
  const store = database.transaction([MUTATIONS_STORE], 'readwrite').objectStore(MUTATIONS_STORE)
  const index = store.index('user_id')

  return new Promise((resolve, reject) => {
    const request = index.getAll(userId)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const mutations = request.result.filter((m) => m.synced_at && m.synced_at < isoDate)
      let deleted = 0
      mutations.forEach((m) => {
        const delRequest = store.delete(m.id)
        delRequest.onsuccess = () => deleted++
        delRequest.onerror = () => reject(delRequest.error)
      })
      setTimeout(() => resolve(deleted), 100)
    }
  })
}

export async function isIndexedDBAvailable() {
  try {
    const request = indexedDB.open('_test_db', 1)
    return new Promise((resolve) => {
      request.onerror = () => resolve(false)
      request.onsuccess = () => {
        indexedDB.deleteDatabase('_test_db')
        resolve(true)
      }
    })
  } catch {
    return false
  }
}
