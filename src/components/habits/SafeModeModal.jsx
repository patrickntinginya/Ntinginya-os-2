import { useState } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { t } from '../../i18n'
import { MINI_MAX, MINI_SUGGESTIONS, NOTE_MAX, defaultEnd, validatePlan } from '../../utils/safeMode'
import { startSafeMode, updatePlan, exitSafeMode } from '../../services/safeMode'
import { isMissingSchema } from '../../services/schemaErrors'
import { friendlyError } from '../../utils/format'

/** Start, edit or leave Safe Mode for one habit. Nothing here changes the habit's recorded history. */
export default function SafeModeModal({ habit, plan, today, onClose, onChanged }) {
  const [mini, setMini] = useState(plan?.mini_version || '')
  const [end, setEnd] = useState(plan ? plan.planned_end || '' : defaultEnd(today))
  const [note, setNote] = useState(plan?.recovery_note || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const fail = (e) => setError(isMissingSchema(e) ? t('safe.err.migration') : friendlyError(e))

  const save = async (e) => {
    e.preventDefault()
    const checked = validatePlan({ mini_version: mini, planned_end: end, recovery_note: note }, today)
    if (!checked.ok) return setError(t(checked.error))
    setBusy(true)
    setError(null)
    try {
      if (plan) await updatePlan(plan.id, checked.values)
      else await startSafeMode(habit.id, checked.values)
      onChanged()
    } catch (err) {
      fail(err)
      setBusy(false)
    }
  }

  const leave = async () => {
    setBusy(true)
    setError(null)
    try {
      await exitSafeMode(plan.id, today)
      onChanged()
    } catch (err) {
      fail(err)
      setBusy(false)
    }
  }

  return (
    <Modal title={t('safe.title')} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('safe.intro', { habit: habit.name })}</p>
        <div>
          <label htmlFor="sm-mini" className="label">{t('safe.mini')} <span className="text-red-500">*</span></label>
          <input id="sm-mini" className="input" required maxLength={MINI_MAX} value={mini} onChange={(e) => setMini(e.target.value)} placeholder={t('safe.miniHint')} />
          <div className="mt-2 flex flex-wrap gap-2" aria-label={t('safe.suggestions')}>
            {MINI_SUGGESTIONS.map((k) => (
              <button key={k} type="button" className="min-h-[44px] rounded-full bg-slate-100 px-3 text-sm text-slate-700 dark:bg-white/10 dark:text-slate-200" onClick={() => setMini(t(k))}>{t(k)}</button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="sm-end" className="label">{t('safe.until')}</label>
          <input id="sm-end" type="date" className="input" min={today} value={end} onChange={(e) => setEnd(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('safe.untilHint')}</p>
        </div>
        <div>
          <label htmlFor="sm-note" className="label">{t('safe.plan')}</label>
          <textarea id="sm-note" className="input" maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('safe.planHint')} />
        </div>
        <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600 dark:bg-white/5 dark:text-slate-300">
          <p className="font-medium">{t('safe.effectTitle')}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>{t('safe.effect1')}</li>
            <li>{t('safe.effect2')}</li>
            <li>{t('safe.effect3')}</li>
          </ul>
        </div>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" loading={busy}>{plan ? t('safe.update') : t('safe.start')}</Button>
        </div>
        {plan && <Button variant="ghost" className="w-full" onClick={leave} disabled={busy}>{t('safe.exit')}</Button>}
      </form>
    </Modal>
  )
}
