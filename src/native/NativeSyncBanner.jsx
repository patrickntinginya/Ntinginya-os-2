import { useCallback, useEffect, useState } from 'react'
import { tr } from '../i18n'
import { repository } from './runtime'

/** Thin status strip on the Reminders screen (Android only): changes waiting to sync, failed changes, skipped conflicts. */
export default function NativeSyncBanner() {
  const [state, setState] = useState({ pending: 0, failed: 0, conflicts: 0 })
  const load = useCallback(() => repository.status().then(setState).catch(() => {}), [])
  useEffect(() => {
    load()
    return repository.subscribe(load)
  }, [load])
  if (!state.pending && !state.failed && !state.conflicts) return null
  const btn = 'ml-2 min-h-[36px] rounded-lg px-3 text-sm font-semibold underline'
  return (
    <div role="status" className="mb-4 space-y-1 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
      {state.pending > 0 && <p>{tr('Waiting to sync: {n}', { n: state.pending })}</p>}
      {state.failed > 0 && (
        <p>
          {tr('Could not save: {n}', { n: state.failed })}
          <button type="button" className={btn} onClick={() => repository.retryFailed().catch(() => {})}>{tr('Retry')}</button>
          <button type="button" className={btn} onClick={() => repository.discardFailed().catch(() => {})}>{tr('Discard')}</button>
        </p>
      )}
      {state.conflicts > 0 && (
        <p>
          {tr('Some changes were skipped because the reminder was changed somewhere else.')}
          <button type="button" className={btn} onClick={() => repository.clearConflicts()}>{tr('Dismiss')}</button>
        </p>
      )}
    </div>
  )
}
