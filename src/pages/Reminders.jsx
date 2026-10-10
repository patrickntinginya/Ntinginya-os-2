import { useMemo } from 'react'
import { Bell, Check, Repeat, CheckSquare, Target } from 'lucide-react'
import ResourcePage from '../components/ResourcePage'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import ItemActions from '../components/ui/ItemActions'
import { REMINDER_PRIORITIES, REMINDER_REPEAT, labelOf } from '../lib/constants'
import { formatDate, formatTime, nextOccurrence, todayISO } from '../utils/date'
import { tr } from '../i18n'

const PRIORITY_TONE = { high: 'danger', medium: 'warn', low: 'neutral' }

function ReminderCard({ reminder, actions, lookups }) {
  const repeating = reminder.repeat_option !== 'none'
  const overdue = !reminder.is_done && reminder.remind_date < todayISO()
  const task = reminder.task_id ? lookups.rows.tasks?.find((t) => t.id === reminder.task_id) : null
  const goal = reminder.goal_id ? lookups.rows.goals?.find((g) => g.id === reminder.goal_id) : null

  // A repeating reminder rolls forward to its next date instead of being marked done.
  const complete = () =>
    repeating
      ? actions.update({ remind_date: nextOccurrence(reminder.remind_date, reminder.repeat_option, reminder.repeat_interval_days) })
      : actions.update({ is_done: !reminder.is_done })

  return (
    <Card className="flex items-start gap-3 p-3">
      <button type="button" onClick={complete}
        aria-label={repeating ? `Done for now: ${reminder.title}` : reminder.is_done ? `Mark ${reminder.title} as not done` : `Mark ${reminder.title} as done`}
        className="flex h-11 w-11 shrink-0 items-center justify-center">
        <span className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${reminder.is_done ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-white/30'}`}>
          {reminder.is_done && <Check size={18} strokeWidth={3} />}
        </span>
      </button>
      <div className="min-w-0 flex-1 py-1.5">
        <p className={`font-medium ${reminder.is_done ? 'text-slate-400 line-through' : ''}`}>{reminder.title}</p>
        <p className={`mt-0.5 text-sm ${overdue ? 'font-semibold text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
          {overdue ? tr('Overdue - ') : ''}{formatDate(reminder.remind_date)}{reminder.remind_time && `, ${formatTime(reminder.remind_time)}`}
        </p>
        {reminder.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{reminder.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={PRIORITY_TONE[reminder.priority]}>{labelOf(REMINDER_PRIORITIES, reminder.priority)}</Badge>
          {repeating && (
            <Badge tone="info"><Repeat size={12} className="mr-1" aria-hidden="true" />
              {reminder.repeat_option === 'custom' ? `Every ${reminder.repeat_interval_days} days` : labelOf(REMINDER_REPEAT, reminder.repeat_option)}
            </Badge>
          )}
          {task && <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"><CheckSquare size={14} aria-hidden="true" /> {task.title}</span>}
          {goal && <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"><Target size={14} aria-hidden="true" /> {goal.name}</span>}
        </div>
      </div>
      <ItemActions label={reminder.title} onEdit={actions.edit} onDelete={actions.remove} />
    </Card>
  )
}

export function makeRemindersConfig() {
  return {
    table: 'reminders',
    title: 'Reminders',
    subtitle: 'Shown in the app and as device notifications while the app is open.',
    singular: 'reminder',
    icon: Bell,
    lookups: ['tasks', 'goals'],
    order: [
      { column: 'is_done', ascending: true },
      { column: 'remind_date', ascending: true },
      { column: 'remind_time', ascending: true, nullsFirst: false },
    ],
    fields: (l) => [
      { name: 'title', label: 'Title', required: true },
      { name: 'remind_date', label: 'Date', type: 'date', required: true, half: true },
      { name: 'remind_time', label: 'Time', type: 'time', half: true },
      { name: 'repeat_option', label: 'Repeat', type: 'select', required: true, options: REMINDER_REPEAT, half: true },
      { name: 'repeat_interval_days', label: 'Every N days', type: 'number', min: '1', max: '365', step: '1', half: true, hint: 'Only for Custom repeat.' },
      { name: 'priority', label: 'Priority', type: 'select', required: true, options: REMINDER_PRIORITIES },
      { name: 'task_id', label: 'Linked task', type: 'select', options: l.options.tasks || [] },
      { name: 'goal_id', label: 'Linked goal', type: 'select', options: l.options.goals || [] },
      { name: 'description', label: 'Description', type: 'textarea' },
    ],
    defaults: () => ({ repeat_option: 'none', priority: 'medium', remind_date: todayISO() }),
    validate: (v) => (v.repeat_option === 'custom' && !(Number(v.repeat_interval_days) >= 1) ? 'Enter how many days between repeats.' : null),
    beforeSave: (v) => ({ ...v, repeat_interval_days: v.repeat_option === 'custom' ? v.repeat_interval_days : null }),
    empty: { title: 'No reminders', text: 'Add a reminder with a date, time and optional repeat.', action: 'Add a reminder' },
    search: ['title', 'description'],
    sections: (items) => [
      { key: 'upcoming', title: 'Upcoming', items: items.filter((r) => !r.is_done) },
      { key: 'done', title: 'Done', items: items.filter((r) => r.is_done) },
    ],
    renderItem: (reminder, actions, lookups) => <ReminderCard reminder={reminder} actions={actions} lookups={lookups} />,
  }
}

export default function Reminders() {
  const config = useMemo(makeRemindersConfig, [])
  return <ResourcePage config={config} />
}
