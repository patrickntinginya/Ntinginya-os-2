import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin, Plus, Repeat, Bell } from 'lucide-react'
import { useResource } from '../hooks/useResource'
import PageHeader from '../components/ui/PageHeader'
import Tabs from '../components/ui/Tabs'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import ErrorState from '../components/ui/ErrorState'
import EmptyState from '../components/ui/EmptyState'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import ItemActions from '../components/ui/ItemActions'
import RecordForm from '../components/RecordForm'
import { ACTIVITY_CATEGORIES, EVENT_REMINDER_OPTIONS, EVENT_REPEAT, labelOf } from '../lib/constants'
import { addDays, addMonths, formatDate, formatMonth, formatTime, startOfMonth, startOfWeek, todayISO } from '../utils/date'
import { expandEvents, findConflicts } from '../utils/metrics'
import { tr } from '../i18n'

const VIEWS = [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const FIELDS = [
  { name: 'title', label: 'Title', required: true },
  { name: 'event_date', label: 'Date', type: 'date', required: true },
  { name: 'start_time', label: 'Starts', type: 'time', required: true, half: true },
  { name: 'end_time', label: 'Ends', type: 'time', half: true },
  { name: 'location', label: 'Location' },
  { name: 'category', label: 'Category', type: 'select', required: true, options: ACTIVITY_CATEGORIES, half: true },
  { name: 'repeat_option', label: 'Repeat', type: 'select', required: true, options: EVENT_REPEAT, half: true },
  { name: 'repeat_until', label: 'Repeat until', type: 'date', hint: 'Optional. Leave empty to repeat with no end.' },
  { name: 'reminder_minutes', label: 'Device reminder', type: 'select', options: EVENT_REMINDER_OPTIONS, cast: 'number', hint: 'Shown as a device notification while the app is open.' },
  { name: 'description', label: 'Description', type: 'textarea' },
]

function EventRow({ e, onEdit, onDelete, conflict }) {
  return (
    <Card className="flex items-start gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{e.title}</p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
          <Clock size={14} aria-hidden="true" />
          {formatTime(e.start_time)}{e.end_time && ` - ${formatTime(e.end_time)}`}
        </p>
        {e.location && <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400"><MapPin size={14} aria-hidden="true" /> {e.location}</p>}
        {e.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{e.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge>{labelOf(ACTIVITY_CATEGORIES, e.category)}</Badge>
          {e.repeat_option !== 'none' && <Badge tone="info"><Repeat size={12} className="mr-1" aria-hidden="true" />{labelOf(EVENT_REPEAT, e.repeat_option)}</Badge>}
          {e.reminder_minutes != null && <Badge><Bell size={12} className="mr-1" aria-hidden="true" />{tr('Alert')}</Badge>}
          {conflict && <Badge tone="warn">{tr('Overlaps another event')}</Badge>}
        </div>
      </div>
      <ItemActions label={e.title} onEdit={onEdit} onDelete={onDelete} />
    </Card>
  )
}

export default function Schedule() {
  const { items, loading, error, reload, create, update, remove } = useResource('schedule_events', {
    order: [{ column: 'event_date', ascending: true }, { column: 'start_time', ascending: true }],
  })
  const today = todayISO()
  const [view, setView] = useState('day')
  const [anchor, setAnchor] = useState(today)
  const [form, setForm] = useState(null)
  const [toDelete, setToDelete] = useState(null)

  const range = useMemo(() => {
    if (view === 'day') return { from: anchor, to: anchor }
    if (view === 'week') { const s = startOfWeek(anchor); return { from: s, to: addDays(s, 6) } }
    const gridStart = startOfWeek(startOfMonth(anchor))
    return { from: gridStart, to: addDays(gridStart, 41) }
  }, [view, anchor])

  const occurrences = useMemo(() => expandEvents(items, range.from, range.to), [items, range])
  const conflictIds = useMemo(() => new Set(findConflicts(occurrences).flatMap(([a, b]) => [`${a.id}:${a.occurrence_date}`, `${b.id}:${b.occurrence_date}`])), [occurrences])
  const byDate = useMemo(() => {
    const m = {}
    for (const o of occurrences) (m[o.occurrence_date] ||= []).push(o)
    return m
  }, [occurrences])

  const step = (dir) => setAnchor(view === 'month' ? addMonths(anchor, dir) : addDays(anchor, dir * (view === 'week' ? 7 : 1)))
  const title = view === 'month' ? formatMonth(startOfMonth(anchor)) : view === 'week' ? `${formatDate(range.from)} - ${formatDate(range.to)}` : formatDate(anchor)

  // Soft warning only: the user can still save an overlapping event. Nothing is ever moved automatically.
  const warn = (v) => {
    if (!v.event_date || !v.start_time || (v.repeat_option && v.repeat_option !== 'none')) return null
    const sameDay = expandEvents(items, v.event_date, v.event_date).filter((e) => e.id !== form?.item?.id)
    const candidate = { id: 'new', title: v.title, occurrence_date: v.event_date, start_time: v.start_time, end_time: v.end_time || null }
    const clash = findConflicts([...sameDay, candidate]).find(([a, b]) => a.id === 'new' || b.id === 'new')
    if (!clash) return null
    const other = clash[0].id === 'new' ? clash[1] : clash[0]
    return `This overlaps "${other.title}" (${formatTime(other.start_time)}). Press Save anyway to keep both.`
  }
  const validate = (v) => (v.end_time && v.start_time && v.end_time.slice(0, 5) <= v.start_time.slice(0, 5) ? 'End time must be after the start time.' : null)
  const save = async (values) => {
    if (form.item) await update(form.item.id, values)
    else await create(values)
  }

  const renderEvent = (e) => (
    <li key={`${e.id}:${e.occurrence_date}`}>
      <EventRow e={e} conflict={conflictIds.has(`${e.id}:${e.occurrence_date}`)} onEdit={() => setForm({ item: items.find((x) => x.id === e.id) })} onDelete={() => setToDelete(items.find((x) => x.id === e.id))} />
    </li>
  )

  const days = view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(range.from, i)) : []
  const monthDays = view === 'month' ? Array.from({ length: 42 }, (_, i) => addDays(range.from, i)) : []

  return (
    <div>
      <PageHeader title={tr('Schedule')} subtitle={tr('Your day, week and month.')}
        action={<Button onClick={() => setForm({ defaults: { event_date: anchor } })}><Plus size={20} aria-hidden="true" /> {tr('Add')}</Button>} />
      <Tabs tabs={VIEWS} value={view} onChange={setView} label={tr('Calendar view')} />

      <div className="mb-4 flex items-center justify-between rounded-2xl bg-white p-1 ring-1 ring-slate-200 dark:bg-white/5 dark:ring-white/10">
        <button type="button" className="icon-btn" onClick={() => step(-1)} aria-label={tr('Previous')}><ChevronLeft size={20} /></button>
        <button type="button" className="min-h-[44px] flex-1 px-2 text-center font-semibold" onClick={() => setAnchor(today)} aria-label={tr('Go to today')}>{title}</button>
        <button type="button" className="icon-btn" onClick={() => step(1)} aria-label={tr('Next')}><ChevronRight size={20} /></button>
      </div>

      {loading ? <Spinner /> : error ? <ErrorState message={error} onRetry={reload} /> : items.length === 0 ? (
        <EmptyState icon={CalendarDays} title={tr('Nothing scheduled')} text={tr('Plan your first activity with a date and time.')} action={<Button onClick={() => setForm({})}>{tr('Add an activity')}</Button>} />
      ) : view === 'day' ? (
        (byDate[anchor] || []).length ? <ul className="space-y-3">{byDate[anchor].map(renderEvent)}</ul>
          : <EmptyState icon={CalendarDays} title={tr('Nothing on this day')} text={tr('Your day is open.')} action={<Button onClick={() => setForm({ defaults: { event_date: anchor } })}>{tr('Add an activity')}</Button>} />
      ) : view === 'week' ? (
        <div className="space-y-5">
          {days.map((d) => (
            <section key={d} aria-label={formatDate(d)}>
              <h2 className={`mb-2 text-sm font-semibold ${d === today ? 'text-brand-700 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400'}`}>{d === today ? tr('Today - ') : ''}{formatDate(d)}</h2>
              {(byDate[d] || []).length ? <ul className="space-y-3">{byDate[d].map(renderEvent)}</ul> : <p className="text-sm text-slate-400">{tr('Nothing scheduled.')}</p>}
            </section>
          ))}
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500 dark:text-slate-400">{WEEKDAYS.map((w) => <span key={w}>{w}</span>)}</div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {monthDays.map((d) => {
              const inMonth = d.slice(0, 7) === anchor.slice(0, 7)
              const n = (byDate[d] || []).length
              return (
                <button key={d} type="button" onClick={() => { setAnchor(d); setView('day') }}
                  aria-label={`${formatDate(d)}, ${n} event${n === 1 ? '' : 's'}`}
                  className={`flex min-h-[52px] flex-col items-center justify-start gap-1 rounded-xl p-1.5 text-sm ${inMonth ? '' : 'opacity-40'} ${d === today ? 'bg-brand-100 font-bold text-brand-800 dark:bg-brand-500/20 dark:text-brand-100' : 'bg-white ring-1 ring-slate-200 dark:bg-white/5 dark:ring-white/10'}`}>
                  {Number(d.slice(8))}
                  {n > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold text-white">{n}</span>}
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{tr('Tap a day to see its events.')}</p>
        </div>
      )}

      {form && (
        <RecordForm title={`${form.item ? 'Edit' : 'New'} activity`} fields={FIELDS} initial={form.item}
          defaults={{ category: 'personal', repeat_option: 'none', event_date: anchor, ...(form.defaults || {}) }}
          validate={validate} warn={warn} onSubmit={save} onClose={() => setForm(null)} />
      )}
      {toDelete && (
        <ConfirmDialog title={tr('Delete activity?')}
          message={`"${toDelete.title}" will be permanently deleted${toDelete.repeat_option !== 'none' ? ', including all its repeats' : ''}.`}
          onConfirm={() => remove(toDelete.id)} onClose={() => setToDelete(null)} />
      )}
    </div>
  )
}
