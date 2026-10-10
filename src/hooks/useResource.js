import { useCallback, useEffect, useRef, useState } from 'react'
import { db } from '../services/db'
import { friendlyError } from '../utils/format'

/**
 * Loads a table and exposes create / update / remove.
 * After each mutation the list is re-fetched so server ordering stays correct.
 * Mutations throw, so the caller (a form or button) can show the error where it happened.
 * `filters` are server-side filters; the list reloads when they change.
 */
export function useResource(table, { order, filters = [], onMutated } = {}) {
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
        const rows = await db.list(table, { order: orderRef.current, filters: filtersRef.current })
        setItems(rows)
        setError(null)
      } catch (e) {
        setError(friendlyError(e))
      } finally {
        setLoading(false)
      }
    },
    [table],
  )

  useEffect(() => {
    load()
  }, [load, filtersKey])

  const create = useCallback(
    async (values) => {
      const row = await db.create(table, values)
      mutatedRef.current?.()
      await load({ silent: true })
      return row
    },
    [table, load],
  )

  const update = useCallback(
    async (id, values) => {
      const row = await db.update(table, id, values)
      mutatedRef.current?.()
      await load({ silent: true })
      return row
    },
    [table, load],
  )

  const remove = useCallback(
    async (id) => {
      await db.remove(table, id)
      mutatedRef.current?.()
      await load({ silent: true })
    },
    [table, load],
  )

  return { items, loading, error, reload: load, create, update, remove }
}
