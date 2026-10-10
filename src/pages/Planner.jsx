import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Lock, Plus, Check } from 'lucide-react'
import { useSnapshot } from '../hooks/useSnapshot'
import { db } from '../services/db'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import ErrorState from '../components/ui/ErrorState'
import AskAiPanel from '../components/ai/AskAiPanel'
import { addDays, formatDate, formatTime, nextOccurrence, todayISO } from '../utils/date'
import { friendlyError } from '../utils/format'
import { expandEvents } from '../utils/metrics'
import { rankTasks } from '../utils/priority'
import { buildPlan, minToTime } from '../utils/planner'
import { tr } from '../i18n'

const KEYS = ['tasks', 'events', 'reminders', 'goals', 'learning']

export default function Planner() {
  const { data, errors, loading, reload, today } = useSnapshot(KEYS)
  const [day, setDay] = useState(todayISO())
  const [added, setAdded] = useState({})
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const plan = useMemo(() => {
    const events = expandEvents(data.events || [], day, day)
    const goals = data.goals || []
    const ranked = rankTasks(data.tasks || [], { today: day, goalsById: Object.fromEntries(goals.map((g) => [g.id, g])) })
    const learning = data.learning || []
    const study = learning.find((l) => l.status === 'learning') || null
    const now = new Date()
    const base = buildPlan({ events, ranked, study, nowMin: day === today ? now.getHours() * 60 + now.getMinutes() : null })
    const reminders = (data.reminders || []).filter((r) => !r.is_done && r.remind_time && (r.remind_date === day || (r.repeat_option !== 'none' && nextOccurrence(r.remind_date, r.repeat_option, r.repeat_interval_days, day) === day)))
    return { ...base, events, reminders }
  }, [data, day, today])

  const items = useMemo(() => [
    ...plan.fixed.map((f) => ({ kind: 'event', start: f.start, end: f.end, title: f.title })),
    ...plan.blocks.map((b) => ({ ...b })),
  ].sort((a, b) => a.start - b.start), [plan])

  const addToSchedule = async (b) => {
    const key = `${b.kind}:${b.refId}:${b.start}`
    setBusy(key)
    setError(null)
    try {
      await db.create('schedule_events', {
        title: b.title, event_date: day, start_time: minToTime(b.start), end_time: minToTime(b.end),
        category: b.kind === 'study' ? 'learning' : 'personal',
      })
      setAdded((a) => ({ ...a, [key]: true }))
      await reload()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <PageHeader title={tr('Planner')} subtitle={tr('Suggested time blocks in your free time. Nothing is added or moved until you tap Add.')} />
      <div className="mb-4 flex items-center gap-2">
        <button type="button" className="btn btn-secondary !min-h-[44px]" onClick={() => setDay(addDays(day, -1))} aria-label={tr('Previous day')}>{tr('Prev')}</button>
        <input type="date" aria-label={tr('Plan date')} className="input flex-1" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        <button type="button" className="btn btn-secondary !min-h-[44px]" onClick={() => setDay(addDays(day, 1))} aria-label={tr('Next day')}>{tr('Next')}</button>
      </div>

      {loading ? <Spinner /> : errors.tasks || errors.events ? <ErrorState message={errors.tasks || errors.events} onRetry={reload} /> : (
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="mb-3 text-base font-semibold">{day === today ? tr('Today') : formatDate(day)}, 08:00 {tr('to')} 20:00</h2>
            {items.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">{tr('No events and no open tasks to plan.')} <Link to="/tasks" className="font-medium text-brand-700 dark:text-brand-300">{tr('Add a task')}</Link>.</p>
            ) : (
              <ul className="space-y-2">
                {items.map((it) => {
                  const key = `${it.kind}:${it.refId}:${it.start}`
                  return (
                    <li key={key + it.title} className={`flex items-center gap-3 rounded-xl p-3 ${it.kind === 'event' ? 'bg-slate-100 dark:bg-white/10' : 'bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-500/10 dark:ring-brand-500/30'}`}>
                      <span className="w-24 shrink-0 text-sm tabular-nums text-slate-600 dark:text-slate-300">{minToTime(it.start)} - {minToTime(it.end)}</span>
                      <span className="min-w-0 flex-1 font-medium">{it.title}</span>
                      {it.kind === 'event' ? <Badge><Lock size={12} className="mr-1" aria-hidden="true" />{tr('Scheduled')}</Badge> : added[key] ? (
                        <Badge tone="brand"><Check size={12} className="mr-1" aria-hidden="true" />{tr('Added')}</Badge>
                      ) : (
                        <Button variant="secondary" className="!min-h-[44px] !px-3" loading={busy === key} onClick={() => addToSchedule(it)} aria-label={`Add ${it.title} to schedule`}><Plus size={16} aria-hidden="true" /> {tr('Add')}</Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
            {plan.unscheduled.length > 0 && <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">{tr('No free time left for:')} {plan.unscheduled.map((u) => u.title).join(', ')}.</p>}
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{tr('Blocks are 45 minutes and follow your task ranking (priority, due date, importance, goal). Existing events are never changed.')}</p>
          </Card>

          {plan.reminders.length > 0 && (
            <Card className="p-4">
              <h2 className="mb-2 text-base font-semibold">{tr('Reminders with a time')}</h2>
              <ul className="space-y-1 text-sm">{plan.reminders.map((r) => <li key={r.id}><span className="tabular-nums text-slate-500">{formatTime(r.remind_time)}</span> {r.title}</li>)}</ul>
            </Card>
          )}

          <AskAiPanel title={tr('Ask AI to plan the day')} description={tr('The assistant can propose events or tasks; each needs your Confirm before it is saved.')}
            prompt={`Plan my day for ${day}. Use my schedule, tasks and goals.`} buttonLabel={tr('Plan my day with AI')} />
        </div>
      )}
    </div>
  )
}
