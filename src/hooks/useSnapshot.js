import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { FINANCE_KEYS, loadSnapshot } from '../services/snapshot'
import { ensureRecurringProcessed } from '../services/recurring'
import { todayISO } from '../utils/date'
import { friendlyError } from '../utils/format'

/**
 * Loads real data for a page. `keys` picks what to load (see services/snapshot.js).
 * data[key] is null when that key failed; errors[key] then holds a friendly message.
 */
export function useSnapshot(keys) {
  const keysRef = useRef(keys)
  const [state, setState] = useState({ data: {}, errors: {} })
  const [loading, setLoading] = useState(true)
  const today = todayISO()

  const load = useCallback(async () => {
    setLoading(true)
    const wanted = keysRef.current
    if (wanted.some((k) => FINANCE_KEYS.includes(k))) await ensureRecurringProcessed(todayISO())
    const { data, errors } = await loadSnapshot(supabase, wanted, todayISO())
    setState({ data, errors: Object.fromEntries(Object.entries(errors).map(([k, e]) => [k, friendlyError(e)])) })
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { data: state.data, errors: state.errors, loading, reload: load, today }
}
