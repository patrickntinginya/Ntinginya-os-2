import { useMemo, useState } from 'react'
import { FolderKanban, Calendar, ChevronDown } from 'lucide-react'
import ResourcePage from '../components/ResourcePage'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import ItemActions from '../components/ui/ItemActions'
import { PROJECT_STATUSES, labelOf } from '../lib/constants'
import { formatDate } from '../utils/date'
import { tr } from '../i18n'

const STATUS_TONE = { planning: 'neutral', active: 'info', on_hold: 'warn', completed: 'brand', archived: 'neutral' }

function Linked({ title, rows, label, done }) {
  if (!rows.length) return null
  return (
    <div className="mt-3">
      <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">{title} ({rows.length})</h3>
      <ul className="mt-1 space-y-1 text-sm">
        {rows.slice(0, 8).map((r) => <li key={r.id} className={done?.(r) ? 'text-slate-400 line-through' : ''}>{label(r)}</li>)}
        {rows.length > 8 && <li className="text-xs text-slate-500">{tr('and')} {rows.length - 8} {tr('more')}</li>}
      </ul>
    </div>
  )
}

function ProjectCard({ project, actions, ctx }) {
  const [open, setOpen] = useState(false)
  const own = (name) => (ctx.extras[name] || []).filter((r) => r.project_id === project.id)
  const tasks = own('tasks'), goals = own('goals'), ideas = own('ideas'), notes = own('notes')
  const done = tasks.filter((t) => t.status === 'completed').length
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{project.name}</p>
          {project.description && <p className="mt-0.5 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{project.description}</p>}
        </div>
        <ItemActions label={project.name} onEdit={actions.edit} onDelete={actions.remove} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[project.status]}>{labelOf(PROJECT_STATUSES, project.status)}</Badge>
        {project.deadline && <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"><Calendar size={14} aria-hidden="true" /> {formatDate(project.deadline)}</span>}
        <span className="text-xs text-slate-500 dark:text-slate-400">{tasks.length ? `${done}/${tasks.length} tasks done` : tr('No tasks linked')} - {goals.length} {tr('goals -')} {ideas.length} {tr('ideas -')} {notes.length} {tr('notes')}</span>
      </div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-2 flex min-h-[44px] items-center gap-1 text-sm font-medium text-brand-700 dark:text-brand-300">
        {open ? tr('Hide details') : tr('Details')} <ChevronDown size={18} className={open ? 'rotate-180' : ''} aria-hidden="true" />
      </button>
      {open && (
        <div className="border-t border-slate-200 dark:border-white/10">
          {project.notes && <p className="mt-3 whitespace-pre-line text-sm">{project.notes}</p>}
          <Linked title={tr('Tasks')} rows={tasks} label={(t) => t.title} done={(t) => t.status === 'completed'} />
          <Linked title={tr('Goals')} rows={goals} label={(g) => g.name} />
          <Linked title={tr('Ideas')} rows={ideas} label={(i) => i.title} />
          <Linked title={tr('Notes')} rows={notes} label={(n) => n.title} />
          {!tasks.length && !goals.length && !ideas.length && !notes.length && !project.notes && (
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{tr('Link tasks, goals, ideas or notes to this project from their own forms.')}</p>
          )}
        </div>
      )}
    </Card>
  )
}

export function makeProjectsConfig() {
  return {
    table: 'projects',
    title: 'Projects',
    subtitle: 'Group tasks, goals, ideas and notes.',
    singular: 'project',
    icon: FolderKanban,
    extras: ['tasks', 'goals', 'ideas', 'notes'],
    order: [{ column: 'created_at', ascending: false }],
    fields: [
      { name: 'name', label: 'Project name', required: true },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'status', label: 'Status', type: 'select', required: true, options: PROJECT_STATUSES, half: true },
      { name: 'deadline', label: 'Deadline', type: 'date', half: true },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    defaults: () => ({ status: 'planning' }),
    empty: { title: 'No projects yet', text: 'Create a project, then link tasks, goals, ideas and notes to it.', action: 'Add a project' },
    search: ['name', 'description'],
    filter: { field: 'status', options: PROJECT_STATUSES },
    itemLabel: (p) => p.name,
    renderItem: (project, actions, lookups, ctx) => <ProjectCard project={project} actions={actions} ctx={ctx} />,
  }
}

export default function Projects() {
  const config = useMemo(makeProjectsConfig, [])
  return <ResourcePage config={config} />
}
