import { useMemo, useState } from 'react'
import { BookOpen, Calendar, Link2, Clock } from 'lucide-react'
import ResourcePage from '../components/ResourcePage'
import RecordForm from '../components/RecordForm'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import ProgressBar from '../components/ui/ProgressBar'
import ConvertButton from '../components/ConvertButton'
import ItemActions from '../components/ui/ItemActions'
import AskAiPanel from '../components/ai/AskAiPanel'
import { db } from '../services/db'
import { LEARNING_STATUSES, labelOf } from '../lib/constants'
import { formatDate, todayISO } from '../utils/date'
import { sum } from '../utils/format'
import { tr } from '../i18n'

const STATUS_TONE = { not_started: 'neutral', learning: 'info', completed: 'brand' }
const SESSION_FIELDS = [
  { name: 'minutes', label: 'Minutes studied', type: 'number', required: true, min: '1', max: '1440', step: '1', half: true, cast: 'number' },
  { name: 'session_date', label: 'Date', type: 'date', required: true, half: true },
  { name: 'notes', label: 'What did you study?', type: 'textarea' },
]

function LearningCard({ item, actions, ctx }) {
  const [logging, setLogging] = useState(false)
  const sessions = (ctx.extras.study_sessions || []).filter((s) => s.learning_item_id === item.id)
  const minutes = sum(sessions, 'minutes')
  const last = sessions.map((s) => s.session_date).sort().pop()
  const resources = String(item.resources || '').split('\n').map((r) => r.trim()).filter(Boolean)

  const logSession = async (v) => {
    await db.create('study_sessions', { learning_item_id: item.id, ...v })
    if (item.status === 'not_started') await actions.update({ status: 'learning' })
    await ctx.reloadExtras()
  }

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{item.topic}</p>
          {item.learning_goal && <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{tr('Goal:')} {item.learning_goal}</p>}
          {item.description && <p className="mt-0.5 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{item.description}</p>}
        </div>
        <ItemActions label={item.topic} onEdit={actions.edit} onDelete={actions.remove} />
      </div>
      <div className="mt-3"><ProgressBar value={item.progress} label={`${item.topic} progress`} /></div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
        <Badge tone={STATUS_TONE[item.status]}>{labelOf(LEARNING_STATUSES, item.status)}</Badge>
        {item.target_date && <span className="inline-flex items-center gap-1"><Calendar size={14} aria-hidden="true" /> {formatDate(item.target_date)}</span>}
        <span className="inline-flex items-center gap-1"><Clock size={14} aria-hidden="true" /> {sessions.length ? `${minutes} min in ${sessions.length} session${sessions.length === 1 ? '' : 's'}, last ${formatDate(last)}` : tr('No study sessions yet')}</span>
      </div>
      {resources.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {resources.map((r) => (
            <li key={r} className="flex items-start gap-1.5 break-all"><Link2 size={14} className="mt-1 shrink-0 text-slate-400" aria-hidden="true" />
              {/^https?:\/\//i.test(r) ? <a href={r} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline dark:text-brand-300">{r}</a> : r}
            </li>
          ))}
        </ul>
      )}
      {item.notes && <p className="mt-3 whitespace-pre-line border-t border-slate-200 pt-3 text-sm dark:border-white/10">{item.notes}</p>}
      <Button variant="secondary" className="mt-3 w-full sm:w-auto" onClick={() => setLogging(true)}>{tr('Log a study session')}</Button>
      {logging && <RecordForm title={`Study session: ${item.topic}`} fields={SESSION_FIELDS} defaults={{ session_date: todayISO() }} onSubmit={logSession} onClose={() => setLogging(false)} />}
      <div className="mt-2 flex flex-wrap gap-x-4 border-t border-slate-100 pt-1 dark:border-white/5">
        <ConvertButton kind="learning_to_goal" source={item} />
      </div>
    </Card>
  )
}

export function makeKnowledgeConfig() {
  return {
    table: 'learning_items',
    title: 'Knowledge',
    subtitle: 'What you are learning and how far along you are.',
    singular: 'topic',
    icon: BookOpen,
    extras: ['study_sessions'],
    order: [{ column: 'progress', ascending: false }, { column: 'created_at', ascending: false }],
    fields: [
      { name: 'topic', label: 'Topic', required: true, placeholder: 'For example: React' },
      { name: 'learning_goal', label: 'Learning goal', placeholder: 'What do you want to be able to do?' },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'status', label: 'Status', type: 'select', required: true, options: LEARNING_STATUSES, half: true },
      { name: 'target_date', label: 'Target date', type: 'date', half: true },
      { name: 'progress', label: 'Progress', type: 'range' },
      { name: 'source', label: 'Main source', placeholder: 'Course, book or person' },
      { name: 'resources', label: 'Resources', type: 'textarea', hint: 'One link or title per line.' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    defaults: () => ({ status: 'not_started', progress: 0 }),
    // Keep status and progress consistent.
    beforeSave: (v) => {
      const out = { ...v }
      if (out.status === 'completed') out.progress = 100
      else if (out.progress === 100) out.status = 'completed'
      else if (out.progress > 0 && out.status === 'not_started') out.status = 'learning'
      return out
    },
    empty: { title: 'Nothing to learn yet', text: 'Add a topic, set a goal and log study sessions as you go.', action: 'Add a topic' },
    search: ['topic', 'description', 'learning_goal', 'notes'],
    filter: { field: 'status', options: LEARNING_STATUSES },
    itemLabel: (i) => i.topic,
    renderItem: (item, actions, lookups, ctx) => <LearningCard item={item} actions={actions} ctx={ctx} />,
  }
}

export default function Knowledge() {
  const config = useMemo(makeKnowledgeConfig, [])
  return (
    <div>
      <AskAiPanel className="mb-5" title={tr('AI learning coach')} mode="learning_plan"
        description={tr('Describe what you want to learn. You get a step-by-step plan; nothing is saved until you press Confirm.')}
        inputLabel="What do you want to learn?" inputPlaceholder="For example: software development" buttonLabel={tr('Create a study plan')} />
      <ResourcePage config={config} />
    </div>
  )
}
