import { useMemo, useState } from 'react'
import { Target, Calendar, ChevronDown, Check, Plus, Trash2, ArrowRightCircle } from 'lucide-react'
import ResourcePage from '../components/ResourcePage'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import ProgressBar from '../components/ui/ProgressBar'
import ConvertButton from '../components/ConvertButton'
import ItemActions from '../components/ui/ItemActions'
import AskAiPanel from '../components/ai/AskAiPanel'
import { db } from '../services/db'
import { GOAL_CATEGORIES, GOAL_PRIORITIES, GOAL_STATUSES, labelOf } from '../lib/constants'
import { formatDate, todayISO } from '../utils/date'
import { friendlyError } from '../utils/format'
import { nextActionForGoal } from '../utils/metrics'
import { effectiveProgress } from '../utils/goals'
import { tr } from '../i18n'

const STATUS_TONE = { active: 'info', completed: 'brand', paused: 'warn', archived: 'neutral' }

function Milestones({ goal, milestones, reload }) {
  const [title, setTitle] = useState('')
  const [error, setError] = useState(null)
  const mine = milestones.filter((m) => m.goal_id === goal.id).sort((a, b) => a.position - b.position)

  const run = async (fn) => {
    setError(null)
    try {
      await fn()
      await reload()
    } catch (e) {
      setError(friendlyError(e))
    }
  }
  const add = (e) => {
    e.preventDefault()
    const t = title.trim()
    if (!t) return
    run(async () => {
      await db.create('milestones', { goal_id: goal.id, title: t, position: mine.length })
      setTitle('')
    })
  }

  return (
    <div className="mt-3 border-t border-slate-200 pt-3 dark:border-white/10">
      <h3 className="text-sm font-semibold">{tr('Milestones')}</h3>
      {mine.length === 0 && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{tr('No milestones yet. Add the main steps toward this goal.')}</p>}
      <ul className="mt-1">
        {mine.map((m) => (
          <li key={m.id} className="flex items-center gap-1">
            <button type="button" role="checkbox" aria-checked={m.is_done} aria-label={`${m.is_done ? 'Reopen' : 'Complete'} milestone ${m.title}`}
              onClick={() => run(() => db.update('milestones', m.id, { is_done: !m.is_done }))} className="flex h-11 w-11 shrink-0 items-center justify-center">
              <span className={`flex h-6 w-6 items-center justify-center rounded-md border-2 ${m.is_done ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-white/30'}`}>
                {m.is_done && <Check size={16} strokeWidth={3} />}
              </span>
            </button>
            <span className={`min-w-0 flex-1 text-sm ${m.is_done ? 'text-slate-400 line-through' : ''}`}>{m.title}{m.due_date && <span className="text-xs text-slate-500"> - {formatDate(m.due_date)}</span>}</span>
            <button type="button" className="icon-btn hover:!text-red-600" aria-label={`Delete milestone ${m.title}`} onClick={() => run(() => db.remove('milestones', m.id))}><Trash2 size={16} /></button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mt-2 flex gap-2">
        <label htmlFor={`ms-${goal.id}`} className="sr-only">{tr('New milestone')}</label>
        <input id={`ms-${goal.id}`} className="input" placeholder={tr('Add a milestone')} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        <Button type="submit" disabled={!title.trim()} aria-label={tr('Add milestone')} className="!px-4"><Plus size={20} aria-hidden="true" /></Button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}

function GoalCard({ goal, actions, ctx }) {
  const [open, setOpen] = useState(false)
  const milestones = ctx.extras.milestones || []
  const tasks = ctx.extras.tasks || []
  const progress = effectiveProgress(goal, milestones)
  const linked = tasks.filter((t) => t.goal_id === goal.id)
  const doneTasks = linked.filter((t) => t.status === 'completed').length
  const next = goal.status === 'active' ? nextActionForGoal(goal, milestones, tasks) : null

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{goal.name}</p>
          {goal.description && <p className="mt-0.5 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{goal.description}</p>}
        </div>
        <ItemActions label={goal.name} onEdit={actions.edit} onDelete={actions.remove} />
      </div>
      <div className="mt-3"><ProgressBar value={progress} label={`${goal.name} progress`} /></div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[goal.status]}>{labelOf(GOAL_STATUSES, goal.status)}</Badge>
        <Badge>{labelOf(GOAL_CATEGORIES, goal.category)}</Badge>
        <Badge tone={goal.priority === 'high' ? 'danger' : goal.priority === 'medium' ? 'warn' : 'neutral'}>{labelOf(GOAL_PRIORITIES, goal.priority)} {tr('priority')}</Badge>
        {goal.target_date && <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"><Calendar size={14} aria-hidden="true" /> {formatDate(goal.target_date)}</span>}
        {linked.length > 0 && <span className="text-xs text-slate-500 dark:text-slate-400">{doneTasks} {tr('of')} {linked.length} {tr('linked tasks done')}</span>}
      </div>
      {next && next.type !== 'none' && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-brand-50 p-3 text-sm text-brand-900 dark:bg-brand-500/15 dark:text-brand-100">
          <ArrowRightCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" /> <span>{next.text}</span>
        </p>
      )}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-2 flex min-h-[44px] items-center gap-1 text-sm font-medium text-brand-700 dark:text-brand-300">
        {open ? tr('Hide milestones and coach') : tr('Milestones and coach')} <ChevronDown size={18} className={open ? 'rotate-180' : ''} aria-hidden="true" />
      </button>
      {open && (
        <>
          <Milestones goal={goal} milestones={milestones} reload={ctx.reloadExtras} />
          <AskAiPanel className="mt-4 !bg-slate-50 dark:!bg-white/5" title={tr('Goal coach')} mode="goal_coach" entityId={goal.id}
            description={tr('Suggests milestones and tasks. Nothing is saved until you press Confirm.')}
            prompt={`Break down my goal "${goal.name}" into milestones and practical tasks.`} buttonLabel={tr('Suggest milestones and tasks')}
            onActionChanged={() => { ctx.reloadExtras(); actions.reload?.({ silent: true }) }} />
        </>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 border-t border-slate-100 pt-1 dark:border-white/5">
        <ConvertButton kind="goal_to_project" source={goal} />
      </div>
    </Card>
  )
}

export function makeGoalsConfig() {
  return {
    table: 'goals',
    title: 'Goals',
    subtitle: 'Where you are headed.',
    singular: 'goal',
    icon: Target,
    lookups: ['projects'],
    extras: ['milestones', 'tasks'],
    order: [{ column: 'target_date', ascending: true, nullsFirst: false }, { column: 'created_at', ascending: false }],
    fields: (l) => [
      { name: 'name', label: 'Goal', required: true },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'category', label: 'Category', type: 'select', required: true, options: GOAL_CATEGORIES, half: true },
      { name: 'priority', label: 'Priority', type: 'select', required: true, options: GOAL_PRIORITIES, half: true },
      { name: 'status', label: 'Status', type: 'select', required: true, options: GOAL_STATUSES },
      { name: 'start_date', label: 'Start date', type: 'date', half: true },
      { name: 'target_date', label: 'Target date', type: 'date', half: true },
      { name: 'project_id', label: 'Project', type: 'select', options: l.options.projects || [] },
      { name: 'progress', label: 'Progress', type: 'range', hint: 'Used only while the goal has no milestones. With milestones, progress follows them.' },
    ],
    defaults: () => ({ category: 'personal', priority: 'medium', status: 'active', progress: 0, start_date: todayISO() }),
    validate: (v) => (v.start_date && v.target_date && v.target_date < v.start_date ? 'Target date must be after the start date.' : null),
    beforeSave: (v) => (v.status === 'completed' ? { ...v, progress: 100 } : v),
    empty: { title: 'No active goals yet', text: 'Write down something you want to achieve, then break it into milestones.', action: 'Add a goal' },
    search: ['name', 'description'],
    filter: { field: 'status', options: GOAL_STATUSES },
    renderItem: (goal, actions, lookups, ctx) => <GoalCard goal={goal} actions={actions} ctx={ctx} />,
  }
}

export default function Goals() {
  const config = useMemo(makeGoalsConfig, [])
  return <ResourcePage config={config} />
}

