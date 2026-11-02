import { supabase } from '../lib/supabase'

let pending = null

/** Creates any due recurring income/expense rows (once per day per session). Never throws. */
export function ensureRecurringProcessed(today) {
  if (pending && pending.day === today) return pending.promise
  const promise = supabase
    .rpc('process_recurring', { p_today: today })
    .then(({ data, error }) => (error ? 0 : data))
    .catch(() => 0)
  pending = { day: today, promise }
  return promise
}

/** Call after the user adds or edits a recurring item so it is processed again on the next load. */
export function resetRecurring() {
  pending = null
}
