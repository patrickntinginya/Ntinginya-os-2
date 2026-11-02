import { useCallback, useEffect, useRef, useState } from 'react'
import { db } from '../services/db'
import { friendlyError } from '../utils/format'

/**
 * Loads a table and exposes create / update / remove.
 * After each mutation the list is re-fetched so server ordering stays correct.
 * Mutations throw, so the caller (a form or button) can show the error where it happened.
 * `filters` are server-side filters; the list reloads when they change.
 */
export function useResource(table, { order, filters = [], onMutated, adapter = db } = {}) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const orderRef = useRef(order)
  const filtersRef = useRef(filters)
  const mutatedRef = useRef(onMutated)
  filtersRef.current = filters
  mutatedRef.current = onMutated
  const filtersKey = JSON.stringify(filters)

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true)
      try {
        const rows = await adapter.list(table, { order: orderRef.current, filters: filtersRef.current })
        setItems(rows)
        setError(null)
      } catch (e) {
        setError(friendlyError(e))
      } finally {
        setLoading(false)
      }
    },
    [table, adapter],
  )

  useEffect(() => {
    load()
  }, [load, filtersKey])

  // An adapter may announce background changes (Android: queued changes finished syncing). db has no subscribe(), so nothing happens on the web.
  useEffect(() => adapter.subscribe?.((event) => { if (event.type === 'synced') load({ silent: true }) }), [adapter, load])

  const create = useCallback(
    async (values) => {
      const row = await adapter.create(table, values)
      mutatedRef.current?.()
      await load({ silent: true })
      return row
    },
    [table, load, adapter],
  )

  const update = useCallback(
    async (id, values) => {
      const row = await adapter.update(table, id, values)
      mutatedRef.current?.()
      await load({ silent: true })
      return row
    },
    [table, load, adapter],
  )

  const remove = useCallback(
    async (id) => {
      await adapter.remove(table, id)
      mutatedRef.current?.()
      await load({ silent: true })
    },
    [table, load, adapter],
  )

  return { items, loading, error, reload: load, create, update, remove }
}
