import { useMemo } from 'react'
import { CheckSquare, Check, Calendar, Repeat, Target, FolderKanban } from 'lucide-react'
import ResourcePage from '../components/ResourcePage'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import ItemActions from '../components/ui/ItemActions'
import { ACTIVITY_CATEGORIES, IMPORTANCE_OPTIONS, RECURRENCE_OPTIONS, TASK_PRIORITIES, TASK_STATUSES, labelOf } from '../lib/constants'
import { formatDate, todayISO } from '../utils/date'
import { recommendPriority } from '../utils/priority'
import { nextRecurringTask } from '../utils/tasks'
import { tr } from '../i18n'

const PRIORITY_TONE = { urgent: 'danger', high: 'danger', medium: 'warn', low: 'neutral' }
const STATUS_TONE = { todo: 'neutral', in_progress: 'info', completed: 'brand', cancelled: 'neutral' }

function TaskCard({ task, actions, lookups }) {
  const today = todayISO()
  const closed = task.status === 'completed' || task.status === 'cancelled'
  const overdue = !closed && task.due_date && task.due_date < today
  const goal = task.goal_id ? lookups.rows.goals?.find((g) => g.id === task.goal_id) : null
  const project = task.project_id ? lookups.rows.projects?.find((p) => p.id === task.project_id) : null
  const rec = closed ? null : recommendPriority(task, { today, goalsById: Object.fromEntries((lookups.rows.goals || []).map((g) => [g.id, g])) })

  const toggle = async () => {
    const done = task.status === 'completed'
    await actions.update({ status: done ? 'todo' : 'completed' })
    // A repeating task creates its next copy when it is completed (never when it is re-opened).
    if (!done) {
      const next = nextRecurringTask(task, today)
      if (next) await actions.create(next)
    }
  }

  return (
    <Card className="flex items-start gap-3 p-3">
      <button type="button" onClick={toggle} role="checkbox" aria-checked={task.status === 'completed'} disabled={task.status === 'cancelled'}
        aria-label={task.status === 'completed' ? `Mark "${task.title}" as to do` : `Mark "${task.title}" as completed`}
        className="flex h-11 w-11 shrink-0 items-center justify-center disabled:opacity-40">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg border-2 ${task.status === 'completed' ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-white/30'}`}>
          {task.status === 'completed' && <Check size={18} strokeWidth={3} />}
        </span>
      </button>
      <div className="min-w-0 flex-1 py-1.5">
        <p className={`font-medium ${closed ? 'text-slate-400 line-through' : ''}`}>{task.title}</p>
        {task.notes && <p className="mt-0.5 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{task.notes}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={PRIORITY_TONE[task.priority]}>{labelOf(TASK_PRIORITIES, task.priority)}</Badge>
          {task.status !== 'todo' && task.status !== 'completed' && <Badge tone={STATUS_TONE[task.status]}>{labelOf(TASK_STATUSES, task.status)}</Badge>}
          <Badge>{labelOf(ACTIVITY_CATEGORIES, task.category)}</Badge>
          {rec && rec.level !== task.priority && (
            <span title={rec.reasons.join(', ') || 'Based on due date and importance'} className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800 ring-1 ring-brand-200 dark:bg-brand-500/10 dark:text-brand-200 dark:ring-brand-500/30">
              {tr('Recommended:')} {labelOf(TASK_PRIORITIES, rec.level)}
            </span>
          )}
          {task.due_date && (
            <span className={`inline-flex items-center gap-1 text-xs ${overdue ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
              <Calendar size={14} aria-hidden="true" /> {overdue ? tr('Overdue - ') : ''}{formatDate(task.due_date)}
            </span>
          )}
          {task.recurrence !== 'none' && <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"><Repeat size={14} aria-hidden="true" /> {labelOf(RECURRENCE_OPTIONS, task.recurrence)}</span>}
          {goal && <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"><Target size={14} aria-hidden="true" /> {goal.name}</span>}
          {project && <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"><FolderKanban size={14} aria-hidden="true" /> {project.name}</span>}
        </div>
      </div>
      <ItemActions label={task.title} onEdit={actions.edit} onDelete={actions.remove} />
    </Card>
  )
}

export function makeTasksConfig() {
  return {
    table: 'tasks',
    title: 'Tasks',
    subtitle: 'What needs doing.',
    singular: 'task',
    icon: CheckSquare,
    lookups: ['goals', 'projects'],
    order: [
      { column: 'due_date', ascending: true, nullsFirst: false },
      { column: 'created_at', ascending: false },
    ],
    fields: (l) => [
      { name: 'title', label: 'Task', required: true, placeholder: 'What needs to be done?' },
      { name: 'priority', label: 'Priority', type: 'select', required: true, options: TASK_PRIORITIES, half: true },
      { name: 'status', label: 'Status', type: 'select', required: true, options: TASK_STATUSES, half: true },
      { name: 'category', label: 'Category', type: 'select', required: true, options: ACTIVITY_CATEGORIES, half: true },
      { name: 'importance', label: 'Importance', type: 'select', required: true, options: IMPORTANCE_OPTIONS, half: true, cast: 'number', hint: 'Used for the Recommended priority.' },
      { name: 'due_date', label: 'Due date', type: 'date', half: true },
      { name: 'recurrence', label: 'Repeat', type: 'select', required: true, options: RECURRENCE_OPTIONS, half: true },
      { name: 'goal_id', label: 'Goal', type: 'select', options: l.options.goals || [] },
      { name: 'project_id', label: 'Project', type: 'select', options: l.options.projects || [] },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    defaults: () => ({ priority: 'medium', status: 'todo', category: 'personal', importance: 3, recurrence: 'none' }),
    empty: { title: 'No tasks yet', text: 'Add your first task and give it a priority and due date.', action: 'Add a task' },
    search: ['title', 'notes'],
    filter: { field: 'status', options: TASK_STATUSES },
    sections: (items) => [
      { key: 'open', title: 'Open', items: items.filter((t) => t.status === 'todo' || t.status === 'in_progress') },
      { key: 'closed', title: 'Completed and cancelled', items: items.filter((t) => t.status === 'completed' || t.status === 'cancelled') },
    ],
    renderItem: (task, actions, lookups) => <TaskCard task={task} actions={actions} lookups={lookups} />,
  }
}

export default function Tasks() {
  const config = useMemo(makeTasksConfig, [])
  return <ResourcePage config={config} />
}
