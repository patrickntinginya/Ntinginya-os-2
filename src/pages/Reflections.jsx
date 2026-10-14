import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import EmptyState from '../components/ui/EmptyState'
import ErrorState from '../components/ui/ErrorState'
import Spinner from '../components/ui/Spinner'
import { useAuth } from '../contexts/AuthContext'
import { t } from '../i18n'
import { createReflection, deleteReflection, listReflections, updateReflection } from '../services/reflections'
import { isMissingSchema } from '../services/schemaErrors'
import { LIMITS, MOODS, canModify, filterEntries, groupByDate, validateReflection, writingStreak } from '../utils/reflections'
import { addDays, formatDate, todayISO } from '../utils/date'
import { friendlyError } from '../utils/format'

const Scale = ({ label, name, value, onChange }) => (
  <fieldset>
    <legend className="label">{label}</legend>
    <div className="grid grid-cols-5 gap-1.5">
      {MOODS.map((n) => (
        <button key={n} type="button" aria-pressed={Number(value) === n} aria-label={`${label}: ${t(`refl.${name}.${n}`)}`} onClick={() => onChange(Number(value) === n ? '' : n)}
          className={`min-h-[48px] rounded-xl text-sm font-semibold ${Number(value) === n ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200'}`}>{n}</button>
      ))}
    </div>
    <p className="mt-1 flex justify-between text-xs text-slate-500 dark:text-slate-400"><span>{t(`refl.${name}.1`)}</span><span>{t(`refl.${name}.5`)}</span></p>
  </fieldset>
)

function EntryForm({ entry, today, onClose, onSaved }) {
  const [v, setV] = useState({ entry_date: entry?.entry_date || today, mood: entry?.mood ?? '', energy: entry?.energy ?? '', went_well: entry?.went_well || '', difficult: entry?.difficult || '', tomorrow_action: entry?.tomorrow_action || '', note: entry?.note || '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    const checked = validateReflection({ ...v, kind: entry?.kind || 'daily' }, today)
    if (!checked.ok) return setError(t(checked.error))
    setBusy(true)
    setError(null)
    try {
      if (entry) await updateReflection(entry.id, checked.values)
      else await createReflection(checked.values)
      onSaved()
    } catch (err) {
      setError(isMissingSchema(err) ? t('refl.err.migration') : friendlyError(err))
      setBusy(false)
    }
  }
  return (
    <Modal title={entry ? t('refl.edit') : t('refl.new')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div><label htmlFor="r-date" className="label">{t('refl.date')}</label><input id="r-date" type="date" className="input" max={today} value={v.entry_date} onChange={set('entry_date')} required /></div>
        <Scale label={t('refl.mood')} name="mood" value={v.mood} onChange={(x) => setV({ ...v, mood: x })} />
        <Scale label={t('refl.energy')} name="energy" value={v.energy} onChange={(x) => setV({ ...v, energy: x })} />
        <div><label htmlFor="r-well" className="label">{t('refl.wentWell')}</label><textarea id="r-well" className="input" maxLength={LIMITS.text} value={v.went_well} onChange={set('went_well')} /></div>
        <div><label htmlFor="r-hard" className="label">{t('refl.difficult')}</label><textarea id="r-hard" className="input" maxLength={LIMITS.text} value={v.difficult} onChange={set('difficult')} /></div>
        <div><label htmlFor="r-act" className="label">{t('refl.tomorrow')}</label><input id="r-act" className="input" maxLength={LIMITS.action} value={v.tomorrow_action} onChange={set('tomorrow_action')} /></div>
        <div><label htmlFor="r-note" className="label">{t('refl.note')}</label><textarea id="r-note" className="input" maxLength={LIMITS.note} value={v.note} onChange={set('note')} /></div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('refl.privacy')}</p>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
        <div className="grid grid-cols-2 gap-3"><Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button><Button type="submit" loading={busy}>{t('refl.save')}</Button></div>
      </form>
    </Modal>
  )
}

export default function Reflections() {
  const { user } = useAuth()
  const today = todayISO()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    try {
      setRows(await listReflections())
      setError(null)
    } catch (e) {
      setError(isMissingSchema(e) ? t('refl.err.migration') : friendlyError(e))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const groups = useMemo(() => groupByDate(filterEntries(rows, q)), [rows, q])
  const streak = useMemo(() => writingStreak(rows, today, addDays), [rows, today])

  return (
    <div>
      <PageHeader title={t('refl.title')} subtitle={t('refl.subtitle')} action={<Button onClick={() => setForm({})}><Plus size={20} aria-hidden="true" /> {t('refl.new')}</Button>} />
      {loading ? <Spinner /> : error ? <ErrorState message={error} onRetry={load} /> : rows.length === 0 ? (
        <EmptyState icon={Pencil} title={t('refl.emptyTitle')} text={t('refl.emptyText')} action={<Button onClick={() => setForm({})}>{t('refl.new')}</Button>} />
      ) : (
        <div className="space-y-4">
          {streak > 1 && <p className="text-sm text-slate-600 dark:text-slate-300" role="status">{t('refl.streak', { n: streak })}</p>}
          <div><label htmlFor="r-search" className="sr-only">{t('refl.search')}</label><input id="r-search" type="search" className="input" placeholder={t('refl.search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {groups.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">{t('refl.noMatch')}</p>}
          {groups.map((g) => (
            <section key={g.date} aria-label={formatDate(g.date)}>
              <h2 className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">{formatDate(g.date)}</h2>
              <ul className="space-y-3">
                {g.items.map((e) => (
                  <li key={e.id}>
                    <Card className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs text-slate-500 dark:text-slate-400">{e.kind === 'calm' ? t('refl.kindCalm') : ''}{e.mood ? ` ${t('refl.mood')}: ${t(`refl.mood.${e.mood}`)}` : ''}{e.energy ? ` ${t('refl.energy')}: ${t(`refl.energy.${e.energy}`)}` : ''}</p>
                        {canModify(e, user?.id) && (
                          <div className="flex shrink-0">
                            <button type="button" className="icon-btn" aria-label={t('common.edit')} onClick={() => setForm(e)}><Pencil size={18} /></button>
                            <button type="button" className="icon-btn" aria-label={t('common.delete')} onClick={() => setToDelete(e)}><Trash2 size={18} /></button>
                          </div>
                        )}
                      </div>
                      {[['went_well', 'refl.wentWell'], ['difficult', 'refl.difficult'], ['tomorrow_action', 'refl.tomorrow'], ['note', 'refl.note']].filter(([k]) => e[k]).map(([k, label]) => (
                        <p key={k} className="mt-2 whitespace-pre-line text-[15px]"><span className="font-semibold">{t(label)}: </span>{e[k]}</p>
                      ))}
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {form && <EntryForm entry={form.id ? form : null} today={today} onClose={() => setForm(null)} onSaved={() => { setForm(null); load() }} />}
      {toDelete && <ConfirmDialog title={t('refl.deleteTitle')} message={t('refl.deleteText')} confirmLabel={t('common.delete')} onConfirm={async () => { await deleteReflection(toDelete.id); load() }} onClose={() => setToDelete(null)} />}
    </div>
  )
}
