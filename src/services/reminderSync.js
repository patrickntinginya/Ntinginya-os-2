/**
 * Synchronization layer between local IndexedDB and Supabase.
 * Handles retries, conflict resolution, and safe mutation ordering.
 */

import { db } from './db'
import {
  getPendingMutations,
  markMutationSynced,
  incrementMutationRetry,
  updateReminderSyncStatus,
  linkLocalReminderToServer,
  saveReminderLocally,
  getRemindersLocally,
} from './offlineStorage'
import { todayISO } from '../utils/date'

const MAX_RETRIES = 3
const SYNC_TIMEOUT = 30000

/**
 * Sync all pending mutations for a user. Returns { success, synced, failed, errors }.
 * Mutations are processed in order of creation to maintain causality.
 */
export async function syncPendingChanges(userId) {
  const mutations = await getPendingMutations(userId)
  const results = { success: true, synced: [], failed: [], errors: [] }

  for (const mutation of mutations) {
    try {
      await syncMutation(mutation, userId)
      results.synced.push(mutation.id)
    } catch (error) {
      results.failed.push(mutation.id)
      results.errors.push({ mutationId: mutation.id, error: error.message })
      results.success = false

      if (mutation.retry_count >= MAX_RETRIES) {
        // Give up after max retries but keep the mutation for manual inspection
        console.error(`Mutation ${mutation.id} failed ${MAX_RETRIES} times. Keeping for manual retry.`)
      }
    }
  }

  return results
}

async function syncMutation(mutation, userId) {
  const { id: mutationId, type, table, reminder_id, data, retry_count } = mutation

  // Update UI to show syncing
  if (reminder_id) {
    await updateReminderSyncStatus(reminder_id, 'syncing').catch(() => {})
  }

  try {
    let serverId
    let controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), SYNC_TIMEOUT)

    try {
      switch (type) {
        case 'create': {
          // Create on server: omit server-only fields
          const { local_id, sync_status, _updated_at, ...payload } = data
          const created = await db.create(table, payload)
          serverId = created.id
          
          // Link local record to server and mark synced
          await linkLocalReminderToServer(reminder_id, serverId)
          await markMutationSynced(mutationId, serverId)
          break
        }

        case 'update': {
          // Update on server: use the server ID from the data or linked record
          const { local_id, sync_status, _updated_at, ...payload } = data
          const serverId = data.id || data.server_id
          if (!serverId) throw new Error('No server ID for update operation')
          
          await db.update(table, serverId, payload)
          await updateReminderSyncStatus(reminder_id, 'synced').catch(() => {})
          await markMutationSynced(mutationId)
          break
        }

        case 'complete': {
          // Mark as done and advance recurring reminders
          const serverId = data.id || data.server_id
          if (!serverId) throw new Error('No server ID for complete operation')
          
          const { is_done, remind_date, repeat_option, repeat_interval_days } = data
          const updateData = { is_done, remind_date }
          
          // Only advance if there's a repeat rule
          if (repeat_option && repeat_option !== 'none') {
            const { nextOccurrence } = await import('../utils/date')
            updateData.remind_date = nextOccurrence(remind_date, repeat_option, repeat_interval_days)
          }
          
          await db.update(table, serverId, updateData)
          await updateReminderSyncStatus(reminder_id, 'synced').catch(() => {})
          await markMutationSynced(mutationId)
          break
        }

        case 'delete': {
          const serverId = data.id || data.server_id
          if (!serverId) throw new Error('No server ID for delete operation')
          
          await db.remove(table, serverId)
          await markMutationSynced(mutationId)
          break
        }

        default:
          throw new Error(`Unknown mutation type: ${type}`)
      }
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (error) {
    // Increment retry counter
    const newRetryCount = await incrementMutationRetry(mutationId)
    
    if (reminder_id) {
      await updateReminderSyncStatus(reminder_id, newRetryCount >= MAX_RETRIES ? 'failed' : 'unsynced').catch(() => {})
    }

    throw new Error(`Sync failed for mutation ${mutationId} (attempt ${newRetryCount}): ${error.message}`)
  }
}

/**
 * Merge local reminders with server reminders.
 * Local unsynced versions take precedence.
 * Returns merged list with sync status attached.
 */
export async function mergeReminderData(serverReminders, userId) {
  let localReminders = []
  try {
    localReminders = await getRemindersLocally(userId)
  } catch (error) {
    console.warn('Could not load local reminders:', error)
  }

  const localMap = new Map(localReminders.map((r) => [r.id || r.local_id, r]))
  const merged = []
  const seenIds = new Set()

  // Add/merge server reminders with local state
  for (const server of serverReminders || []) {
    seenIds.add(server.id)
    const local = localMap.get(server.id)
    
    if (local && local.sync_status === 'unsynced') {
      // Local unsynced version overrides server
      merged.push({ ...server, ...local, sync_status: 'unsynced' })
    } else if (local && local.sync_status === 'syncing') {
      // In-flight; show server data but mark as pending
      merged.push({ ...server, sync_status: 'syncing' })
    } else if (local && local.sync_status === 'failed') {
      // Failed sync; show local with error state
      merged.push({ ...local, sync_status: 'failed' })
    } else {
      // Use server version
      merged.push({ ...server, sync_status: 'synced' })
    }
  }

  // Add local-only reminders (created but not yet synced)
  for (const local of localReminders) {
    if (!seenIds.has(local.id)) {
      merged.push({ ...local, sync_status: local.sync_status || 'unsynced' })
    }
  }

  return merged
}

/**
 * Handle conflict when server data is newer than local.
 * Strategy: server wins for fields, but preserve unsynced local data.
 */
export async function resolveConflict(local, server) {
  // If server is newer, use server version but keep unsynced local fields
  const serverTimestamp = new Date(server.updated_at || server.created_at)
  const localTimestamp = new Date(local.updated_at || local.created_at)

  if (serverTimestamp >= localTimestamp) {
    // Server is newer or same age
    return { ...server, sync_status: 'synced' }
  }

  // Local is newer; keep it unsynced
  return { ...local, sync_status: 'unsynced' }
}
