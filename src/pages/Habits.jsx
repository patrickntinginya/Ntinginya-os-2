import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Archive, Check, ChevronDown, Flame, Pencil, Plus, RotateCcw, Trash2, Repeat } from 'lucide-react'
import { useSnapshot } from '../hooks/useSnapshot'
import { supabase } from '../lib/supabase'
import { setHabitDone } from '../services/habits'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import EmptyState from '../components/ui/EmptyState'
import ErrorState from '../components/ui/ErrorState'
import Spinner from '../components/ui/Spinner'
import StatCard from '../components/ui/StatCard'
import { addDays, formatTime, toISODate } from '../utils/date'
import { friendlyError } from '../utils/format'
import { WEEKDAY_NAMES, doneMap, habitInsights, habitSummary, isDue, overallCompletion } from '../utils/habits'
import { tr } from '../i18n'

const KEYS = ['habits', 'habitEntries', 'goals']
const SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function HabitForm({ habit, goals, onClose, onSaved }) {
  const [v, setV] = useState({
    name: habit?.name || '', description: habit?.description || '',
    days: habit?.days_of_week?.length ? habit.days_of_week : [0, 1, 2, 3, 4, 5, 6],
    start_date: habit?.start_date || toISODate(), reminder_time: habit?.reminder_time ? String(habit.reminder_time).slice(0, 5) : '', goal_id: habit?.goal_id || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const toggleDay = (d) => setV((x) => ({ ...x, days: x.days.includes(d) ? x.days.filter((k) => k !== d) : [...x.days, d].sort() }))

  const submit = async (e) => {
    e.preventDefault()
    if (!v.days.length) return setError('Choose at least one day.')
    setBusy(true)
    setError(null)
    const row = {
      name: v.name.trim(), description: v.description.trim() || null, days_of_week: v.days, start_date: v.start_date,
      reminder_time: v.reminder_time || null, goal_id: v.goal_id || null,
    }
    const { error: err } = habit ? await supabase.from('habits').update(row).eq('id', habit.id) : await supabase.from('habits').insert(row)
    if (err) {
      setError(friendlyError(err))
      setBusy(false)
      return
    }
    onSaved()
  }

  return (
    <Modal title={habit ? 'Edit habit' : 'New habit'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div><label htmlFor="h-name" className="label">{tr('Habit')} <span className="text-red-500">*</span></label><input id="h-name" className="input" required maxLength={120} placeholder={tr('For example: Read 30 minutes')} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
        <div><label htmlFor="h-desc" className="label">{tr('Description')}</label><textarea id="h-desc" className="input" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></div>
        <fieldset>
          <legend className="label">{tr('Days')}</legend>
          <div className="grid grid-cols-7 gap-1.5">
            {SHORT.map((l, d) => (
              <button key={d} type="button" aria-pressed={v.days.includes(d)} aria-label={WEEKDAY_NAMES[d]} onClick={() => toggleDay(d)}
                className={`min-h-[48px] rounded-xl text-sm font-semibold ${v.days.includes(d) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300'}`}>{l}</button>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <div><label htmlFor="h-start" className="label">{tr('Start date')}</label><input id="h-start" type="date" className="input" required value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} /></div>
          <div><label htmlFor="h-rem" className="label">{tr('Reminder time')}</label><input id="h-rem" type="time" className="input" value={v.reminder_time} onChange={(e) => setV({ ...v, reminder_time: e.target.value })} /></div>
        </div>
        <div><label htmlFor="h-goal" className="label">{tr('Linked goal')}</label>
          <select id="h-goal" className="input" value={v.goal_id} onChange={(e) => setV({ ...v, goal_id: e.target.value })}>
            <option value="">{tr('None')}</option>
            {goals.filter((g) => g.status === 'active').map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
        <div className="grid grid-cols-2 gap-3"><Button variant="secondary" onClick={onClose} disabled={busy}>{tr('Cancel')}</Button><Button type="submit" loading={busy}>{tr('Save')}</Button></div>
      </form>
    </Modal>
  )
}

function HabitCard({ s, today, onToggle, onEdit, onArchive, onDelete, goalName, archived }) {
  const [open, setOpen] = useState(false)
  const { habit } = s
  const days = Array.from({ length: 28 }, (_, i) => addDays(today, i - 27))
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        {!archived && (
          s.dueToday ? (
            <button type="button" role="checkbox" aria-checked={s.doneToday} aria-label={`${habit.name}: ${s.doneToday ? 'done today, tap to undo' : 'mark done today'}`} onClick={() => onToggle(habit.id, today, !s.doneToday)} className="flex h-12 w-12 shrink-0 items-center justify-center">
              <span className={`flex h-9 w-9 items-center justify-center rounded-xl border-2 ${s.doneToday ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-white/30'}`}>{s.doneToday && <Check size={22} strokeWidth={3} />}</span>
            </button>
          ) : <span className="flex h-12 w-12 shrink-0 items-center justify-center text-xs text-slate-400">{tr('Off')}</span>
        )}
        <div className="min-w-0 flex-1 py-1">
          <p className="font-medium">{habit.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            {s.streak > 0 && <Badge tone="warn"><Flame size={12} className="mr-1" aria-hidden="true" />{s.streak}{tr('-day streak')}</Badge>}
            {s.week && <span>{tr('Week')} {s.week.rate}%</span>}
            {habit.reminder_time && <span className="inline-flex items-center gap-1"><Repeat size={12} aria-hidden="true" />{formatTime(habit.reminder_time)}</span>}
            {!s.dueToday && !archived && <span>{tr('Not due today')}</span>}
          </div>
        </div>
        <button type="button" className="icon-btn" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} history for ${habit.name}`} onClick={() => setOpen((o) => !o)}><ChevronDown size={20} className={open ? 'rotate-180' : ''} /></button>
      </div>

      {open && (
        <div className="mt-3 border-t border-slate-200 pt-3 dark:border-white/10">
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div><dd className="text-lg font-bold tabular-nums">{s.streak}</dd><dt className="text-xs text-slate-500 dark:text-slate-400">{tr('Current')}</dt></div>
            <div><dd className="text-lg font-bold tabular-nums">{s.longest}</dd><dt className="text-xs text-slate-500 dark:text-slate-400">{tr('Longest')}</dt></div>
            <div><dd className="text-lg font-bold tabular-nums">{s.month ? `${s.month.rate}%` : '-'}</dd><dt className="text-xs text-slate-500 dark:text-slate-400">{tr('This month')}</dt></div>
          </dl>
          <h3 className="mb-1 mt-3 text-xs font-semibold text-slate-500 dark:text-slate-400">{tr('Last 28 days')}{archived ? '' : ' (tap a day to correct it)'}</h3>
          <div className="grid grid-cols-7 gap-1.5" role="group" aria-label={`History for ${habit.name}`}>
            {days.map((d) => {
              const due = isDue(habit, d)
              const done = s.done.has(d)
              return (
                <button key={d} type="button" disabled={archived || !due} onClick={() => onToggle(habit.id, d, !done)} aria-label={`${d}: ${!due ? 'not due' : done ? 'done' : 'missed'}`} aria-pressed={done}
                  className={`h-9 rounded-lg text-xs tabular-nums ${done ? 'bg-brand-600 text-white' : due ? 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-300' : 'bg-transparent text-slate-300 dark:text-white/20'}`}>{Number(d.slice(8))}</button>
              )
            })}
          </div>
          <ul className="mt-3 space-y-1 text-sm">{habitInsights(s, today).map((t) => <li key={t}>{t}</li>)}</ul>
          {goalName && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{tr('Linked goal:')} {goalName}</p>}
          <div className="mt-2 flex flex-wrap gap-1">
            {!archived && <button type="button" className="inline-flex min-h-[44px] items-center gap-1.5 px-2 text-sm font-medium" onClick={() => onEdit(habit)}><Pencil size={16} aria-hidden="true" />{tr('Edit')}</button>}
            <button type="button" className="inline-flex min-h-[44px] items-center gap-1.5 px-2 text-sm font-medium" onClick={() => onArchive(habit)}>{archived ? <><RotateCcw size={16} aria-hidden="true" />{tr('Restore')}</> : <><Archive size={16} aria-hidden="true" />{tr('Archive')}</>}</button>
            {archived && <button type="button" className="inline-flex min-h-[44px] items-center gap-1.5 px-2 text-sm font-medium text-red-600" onClick={() => onDelete(habit)}><Trash2 size={16} aria-hidden="true" />{tr('Delete')}</button>}
          </div>
        </div>
      )}
    </Card>
  )
}

export default function Habits() {
  const { data, errors, loading, reload, today } = useSnapshot(KEYS)
  const [form, setForm] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const [overrides, setOverrides] = useState({}) // `${habitId}|${date}` -> true/false, applied on top of the loaded entries
  const [error, setError] = useState(null)
  const [showArchived, setShowArchived] = useState(false)

  const entries = useMemo(() => {
    const base = (data.habitEntries || []).filter((e) => overrides[`${e.habit_id}|${e.entry_date}`] !== false)
    const have = new Set(base.map((e) => `${e.habit_id}|${e.entry_date}`))
    const added = Object.entries(overrides).filter(([k, val]) => val && !have.has(k)).map(([k]) => { const [habit_id, entry_date] = k.split('|'); return { habit_id, entry_date } })
    return [...base, ...added]
  }, [data.habitEntries, overrides])

  const map = useMemo(() => doneMap(entries), [entries])
  const habits = data.habits || []
  const active = habits.filter((h) => !h.archived_at)
  const archived = habits.filter((h) => h.archived_at)
  const summaries = useMemo(() => active.map((h) => habitSummary(h, map.get(h.id) || new Set(), today)), [active, map, today])
  const goals = data.goals || []
  const goalName = (id) => goals.find((g) => g.id === id)?.name

  const dueToday = summaries.filter((s) => s.dueToday)
  const doneToday = dueToday.filter((s) => s.doneToday).length
  const last7 = overallCompletion(active, map, addDays(today, -6), addDays(today, 1), today)
  const best = summaries.reduce((b, s) => Math.max(b, s.streak), 0)

  const toggle = async (habitId, date, done) => {
    setError(null)
    const key = `${habitId}|${date}`
    setOverrides((o) => ({ ...o, [key]: done }))
    try {
      await setHabitDone(habitId, date, done)
    } catch (e) {
      setOverrides((o) => ({ ...o, [key]: !done }))
      setError(friendlyError(e))
    }
  }
  const archive = async (h) => {
    const { error: err } = await supabase.from('habits').update({ archived_at: h.archived_at ? null : new Date().toISOString() }).eq('id', h.id)
    if (err) setError(friendlyError(err))
    else reload()
  }
  const remove = async () => {
    const { error: err } = await supabase.from('habits').delete().eq('id', toDelete.id)
    if (err) throw err
    reload()
  }

  return (
    <div>
      <PageHeader title={tr('Habits')} subtitle={tr('Small things you repeat. Streaks count only the days a habit is due.')} action={<Button onClick={() => setForm({})}><Plus size={20} aria-hidden="true" /> {tr('Add')}</Button>} />
      {error && <div className="mb-4"><ErrorState message={error} compact /></div>}
      {loading ? <Spinner /> : errors.habits ? <ErrorState message={errors.habits} onRetry={reload} /> : habits.length === 0 ? (
        <EmptyState icon={Repeat} title={tr('No habits yet')} text={tr('Add a habit like reading, exercise or reviewing your finances, then tick it off each day.')} action={<Button onClick={() => setForm({})}>{tr('Add a habit')}</Button>} />
      ) : (
        <div className="space-y-4">
          {active.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <StatCard label={tr('Done today')} value={dueToday.length ? `${doneToday}/${dueToday.length}` : '-'} hint={dueToday.length ? undefined : 'Nothing due today'} />
              <StatCard label={tr('Last 7 days')} value={last7 ? `${last7.rate}%` : '-'} hint={last7 ? `${last7.done} of ${last7.due}` : 'No data yet'} />
              <StatCard label={tr('Best streak')} value={best} hint={tr('days')} />
            </div>
          )}
          <ul className="space-y-3">
            {summaries.map((s) => (
              <li key={s.habit.id}><HabitCard s={s} today={today} onToggle={toggle} onEdit={setForm} onArchive={archive} goalName={goalName(s.habit.goal_id)} /></li>
            ))}
          </ul>
          {active.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">{tr('All your habits are archived.')}</p>}
          {archived.length > 0 && (
            <div>
              <button type="button" className="min-h-[44px] text-sm font-medium text-brand-700 dark:text-brand-300" aria-expanded={showArchived} onClick={() => setShowArchived((x) => !x)}>{showArchived ? tr('Hide') : tr('Show')} {tr('archived (')}{archived.length})</button>
              {showArchived && <ul className="mt-2 space-y-3">{archived.map((h) => <li key={h.id}><HabitCard archived s={habitSummary(h, map.get(h.id) || new Set(), today)} today={today} onToggle={toggle} onArchive={archive} onDelete={setToDelete} /></li>)}</ul>}
            </div>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400">{tr('Habit reminders appear in')} <Link to="/notifications" className="font-medium text-brand-700 dark:text-brand-300">{tr('Notifications')}</Link> {tr('once the reminder time has passed and the habit is not done. They are not push notifications.')}</p>
        </div>
      )}
      {form && <HabitForm habit={form.id ? form : null} goals={goals} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload() }} />}
      {toDelete && <ConfirmDialog title={tr('Delete habit?')} message={`"${toDelete.name}" and its whole history will be permanently deleted.`} onConfirm={remove} onClose={() => setToDelete(null)} />}
    </div>
  )
}
