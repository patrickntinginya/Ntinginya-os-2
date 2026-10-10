import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, CalendarDays, Bell, Target, Plus, Wallet, CheckSquare } from 'lucide-react'
import { useSnapshot } from '../hooks/useSnapshot'
import { useLookups } from '../hooks/useLookups'
import { db } from '../services/db'
import { completeTask } from '../services/taskActions'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'
import ErrorState from '../components/ui/ErrorState'
import AskAiPanel from '../components/ai/AskAiPanel'
import { formatDate, formatLongDate, formatTime, nextOccurrence } from '../utils/date'
import { formatMoney, friendlyError } from '../utils/format'
import { dailyInsight, expandEvents, findConflicts, goalsNeedingAttention, isOpenTask } from '../utils/metrics'
import { rankTasks } from '../utils/priority'
import { labelOf, TASK_PRIORITIES } from '../lib/constants'
import { tr } from '../i18n'

const KEYS = ['tasks', 'events', 'reminders', 'goals', 'milestones']

const Section = ({ icon: Icon, title, to, children }) => (
  <Card className="p-4">
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-base font-semibold">{Icon && <Icon size={18} className="text-brand-600 dark:text-brand-300" aria-hidden="true" />} {title}</h2>
      {to && <Link to={to} className="flex min-h-[44px] items-center px-1 text-sm font-medium text-brand-700 dark:text-brand-300">{tr('Open')}</Link>}
    </div>
    {children}
  </Card>
)
const Muted = ({ children }) => <p className="text-sm text-slate-500 dark:text-slate-400">{children}</p>

function Check1({ done, label, onClick, busy }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} role="checkbox" aria-checked={done} aria-label={label} className="flex h-11 w-11 shrink-0 items-center justify-center disabled:opacity-50">
      <span className={`flex h-7 w-7 items-center justify-center rounded-lg border-2 ${done ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-white/30'}`}>{done && <Check size={18} strokeWidth={3} />}</span>
    </button>
  )
}

function QuickExpense({ today, onSaved }) {
  const { options } = useLookups(['expense_categories'])
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('food')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    const n = Number(amount)
    if (!(n > 0)) return setMsg({ error: 'Enter an amount greater than zero.' })
    setBusy(true)
    setMsg(null)
    try {
      await db.create('expenses', { amount: n, category, entry_date: today, notes: notes.trim() || null })
      setMsg({ ok: `Saved ${formatMoney(n)} for ${labelOf([], category)}.` })
      setAmount('')
      setNotes('')
      onSaved?.()
    } catch (err) {
      setMsg({ error: friendlyError(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3">
      <div><label htmlFor="qe-amount" className="label">{tr('Amount (TSh)')}</label><input id="qe-amount" className="input" type="number" inputMode="numeric" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="20000" /></div>
      <div><label htmlFor="qe-cat" className="label">{tr('Category')}</label>
        <select id="qe-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>{(options.expense_categories || []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
      <div className="col-span-2"><label htmlFor="qe-notes" className="label">{tr('Note (optional)')}</label><input id="qe-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} /></div>
      <Button type="submit" loading={busy} className="col-span-2"><Wallet size={18} aria-hidden="true" /> {tr('Record expense')}</Button>
      {msg?.ok && <p role="status" className="col-span-2 text-sm text-brand-700 dark:text-brand-300">{msg.ok}</p>}
      {msg?.error && <p role="alert" className="col-span-2 text-sm text-red-600 dark:text-red-400">{msg.error}</p>}
    </form>
  )
}

function QuickTask({ today, onSaved }) {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState('medium')
  const [dueToday, setDueToday] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    setError(null)
    try {
      await db.create('tasks', { title: title.trim(), priority, due_date: dueToday ? today : null })
      setTitle('')
      onSaved?.()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div><label htmlFor="qt-title" className="label">{tr('New task')}</label><input id="qt-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tr('What needs doing?')} maxLength={200} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label htmlFor="qt-pri" className="label">{tr('Priority')}</label><select id="qt-pri" className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>{TASK_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></div>
        <label className="mt-7 flex min-h-[48px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-brand-600" checked={dueToday} onChange={(e) => setDueToday(e.target.checked)} /> {tr('Due today')}</label>
      </div>
      <Button type="submit" loading={busy} disabled={!title.trim()} className="w-full"><Plus size={18} aria-hidden="true" /> {tr('Add task')}</Button>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </form>
  )
}

export default function Today() {
  const { data, errors, loading, reload, today } = useSnapshot(KEYS)
  const [busyId, setBusyId] = useState(null)
  const [actionError, setActionError] = useState(null)

  const v = useMemo(() => {
    const tasks = data.tasks || []
    const goals = data.goals || []
    const events = expandEvents(data.events || [], today, today)
    return {
      tasks, events,
      ranked: rankTasks(tasks, { today, goalsById: Object.fromEntries(goals.map((g) => [g.id, g])) }),
      todayTasks: tasks.filter((t) => isOpenTask(t) && t.due_date && t.due_date <= today),
      reminders: (data.reminders || []).filter((r) => !r.is_done && r.remind_date <= today),
      flags: goalsNeedingAttention(goals, data.milestones || [], tasks, today),
      conflicts: findConflicts(events),
    }
  }, [data, today])

  const run = async (id, fn) => {
    setBusyId(id)
    setActionError(null)
    try {
      await fn()
      await reload()
    } catch (e) {
      setActionError(friendlyError(e))
    } finally {
      setBusyId(null)
    }
  }
  const doneReminder = (r) =>
    run(r.id, () => db.update('reminders', r.id, r.repeat_option !== 'none' ? { remind_date: nextOccurrence(r.remind_date, r.repeat_option, r.repeat_interval_days) } : { is_done: true }))

  const failed = errors.tasks || errors.events
  return (
    <div>
      <PageHeader title={tr('My Day')} subtitle={formatLongDate()} />
      {loading ? <Spinner /> : failed ? <ErrorState message={failed} onRetry={reload} /> : (
        <div className="space-y-4">
          <Card className="p-4"><p className="text-[15px]">{dailyInsight({ tasks: v.tasks, events: v.events, goalFlags: v.flags }, today)}</p></Card>
          {actionError && <ErrorState message={actionError} compact />}

          <Section icon={CheckSquare} title={tr('Top 3 priorities')} to="/tasks">
            {v.ranked.length === 0 ? <Muted>{tr('No open tasks. Add one below.')}</Muted> : (
              <ol>
                {v.ranked.slice(0, 3).map(({ task, rec }, i) => (
                  <li key={task.id} className="flex items-start gap-1 border-t border-slate-100 first:border-t-0 dark:border-white/5">
                    <Check1 done={false} busy={busyId === task.id} label={`Complete ${task.title}`} onClick={() => run(task.id, () => completeTask(task, today))} />
                    <div className="min-w-0 flex-1 py-2.5"><p className="font-medium"><span className="text-slate-400">{i + 1}.</span> {task.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{rec.reasons.length ? rec.reasons.join(', ') : tr('Recommended from your priority and importance')}{task.due_date ? ` - due ${formatDate(task.due_date)}` : ''}</p></div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section icon={CheckSquare} title={tr('Due today and overdue')} to="/tasks">
            {v.todayTasks.length === 0 ? <Muted>{tr('No tasks for today.')}</Muted> : (
              <ul>{v.todayTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-1 border-t border-slate-100 first:border-t-0 dark:border-white/5">
                  <Check1 done={false} busy={busyId === t.id} label={`Complete ${t.title}`} onClick={() => run(t.id, () => completeTask(t, today))} />
                  <span className="min-w-0 flex-1 py-2 font-medium">{t.title}</span>{t.due_date < today && <Badge tone="danger">{tr('Overdue')}</Badge>}
                </li>))}
              </ul>
            )}
          </Section>

          <Section icon={CalendarDays} title={tr('Today\'s schedule')} to="/schedule">
            {v.events.length === 0 ? <Muted>{tr('Nothing scheduled today.')}</Muted> : (
              <ul className="space-y-2">{v.events.map((e) => <li key={`${e.id}${e.occurrence_date}`} className="flex justify-between gap-3"><span className="font-medium">{e.title}</span><span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">{formatTime(e.start_time)}{e.end_time && ` - ${formatTime(e.end_time)}`}</span></li>)}</ul>
            )}
            {v.conflicts.length > 0 && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{v.conflicts.length} {tr('overlapping')} {v.conflicts.length === 1 ? 'event' : 'events'} {tr('today.')}</p>}
          </Section>

          <Section icon={Bell} title={tr('Reminders')} to="/reminders">
            {v.reminders.length === 0 ? <Muted>{tr('No reminders due today.')}</Muted> : (
              <ul>{v.reminders.map((r) => (
                <li key={r.id} className="flex items-center gap-1 border-t border-slate-100 first:border-t-0 dark:border-white/5">
                  <Check1 done={false} busy={busyId === r.id} label={`Done: ${r.title}`} onClick={() => doneReminder(r)} />
                  <span className="min-w-0 flex-1 py-2 font-medium">{r.title}</span><span className="text-xs text-slate-500">{r.remind_date < today ? tr('Overdue') : formatTime(r.remind_time)}</span>
                </li>))}
              </ul>
            )}
          </Section>

          <Section icon={Target} title={tr('Goals needing attention')} to="/goals">
            {v.flags.length === 0 ? <Muted>{(data.goals || []).some((g) => g.status === 'active') ? tr('No goal needs attention right now.') : tr('No active goals yet.')}</Muted> : (
              <ul className="space-y-3">{v.flags.slice(0, 4).map((f) => <li key={f.goal.id}><p className="font-medium">{f.goal.name}</p><p className="text-sm text-slate-500 dark:text-slate-400">{f.reasons.join('. ')}.</p></li>)}</ul>
            )}
          </Section>

          <Section icon={Wallet} title={tr('Quick expense')}><QuickExpense today={today} /></Section>
          <Section icon={Plus} title={tr('Quick task')}><QuickTask today={today} onSaved={reload} /></Section>

          <AskAiPanel title={tr('AI recommendation')} description={tr('Uses your tasks, schedule, goals and money to suggest what to focus on. It can propose tasks or events, which you confirm first.')}
            prompt={tr('What should I prioritize today? Give a short plan.')} buttonLabel={tr('What should I focus on?')} />
        </div>
      )}
    </div>
  )
}
