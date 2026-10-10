import { useMemo, useState } from 'react'
import { Lightbulb, ChevronDown, ArrowRightCircle } from 'lucide-react'
import ResourcePage from '../components/ResourcePage'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import ConvertButton from '../components/ConvertButton'
import ItemActions from '../components/ui/ItemActions'
import AskAiPanel from '../components/ai/AskAiPanel'
import { IDEA_POTENTIAL, IDEA_STATUSES, labelOf } from '../lib/constants'
import { tr } from '../i18n'

const DETAILS = [
  ['description', 'Description'], ['problem', 'Problem'], ['proposed_solution', 'Proposed solution'],
  ['target_users', 'Target users'], ['business_opportunity', 'Business opportunity'], ['notes', 'Notes'],
]
const POTENTIAL_TONE = { high: 'brand', medium: 'warn', low: 'neutral' }

function IdeaCard({ idea, actions }) {
  const [open, setOpen] = useState(false)
  const [fresh, setFresh] = useState(null) // validation text not saved yet
  const [saving, setSaving] = useState(false)
  const filled = DETAILS.filter(([key]) => idea[key])

  const saveValidation = async () => {
    setSaving(true)
    await actions.update({ ai_validation: fresh, ai_validated_at: new Date().toISOString() })
    setSaving(false)
    setFresh(null)
  }

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{idea.title}</p>
          {(idea.description || idea.problem) && !open && <p className="mt-0.5 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{idea.description || idea.problem}</p>}
        </div>
        <ItemActions label={idea.title} onEdit={actions.edit} onDelete={actions.remove} />
      </div>
      {idea.next_action && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-brand-50 p-3 text-sm text-brand-900 dark:bg-brand-500/15 dark:text-brand-100">
          <ArrowRightCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span><span className="font-semibold">{tr('Next:')}</span> {idea.next_action}</span>
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select aria-label={`Status of ${idea.title}`} className="input !min-h-[44px] !w-auto" value={idea.status} onChange={(e) => actions.update({ status: e.target.value })}>
          {IDEA_STATUSES.map((s) => <option key={s.value} value={s.value}>{tr(s.label)}</option>)}
        </select>
        {idea.potential && <Badge tone={POTENTIAL_TONE[idea.potential]}>{labelOf(IDEA_POTENTIAL, idea.potential)} {tr('potential')}</Badge>}
        {idea.category && <Badge>{idea.category}</Badge>}
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="ml-auto flex min-h-[44px] items-center gap-1 px-2 text-sm font-medium text-brand-700 dark:text-brand-300">
          {open ? tr('Hide') : tr('Details and AI check')} <ChevronDown size={18} className={open ? 'rotate-180' : ''} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div className="mt-3 space-y-4 border-t border-slate-200 pt-3 dark:border-white/10">
          {filled.length > 0 && (
            <dl className="space-y-3">
              {filled.map(([key, label]) => (
                <div key={key}><dt className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</dt><dd className="mt-0.5 whitespace-pre-line text-sm">{idea[key]}</dd></div>
              ))}
            </dl>
          )}
          {idea.ai_validation && !fresh && (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">{tr('Saved AI validation')}</h3>
              <p className="mt-1 whitespace-pre-line rounded-xl bg-slate-50 p-3 text-sm dark:bg-white/5">{idea.ai_validation}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{tr('Based on general knowledge and your idea details, not market research. Statements marked "Assumption" are unverified.')}</p>
            </div>
          )}
          <AskAiPanel title={tr('Validate with AI')} mode="idea_validation" entityId={idea.id}
            description={tr('Checks problem, customer, competition, risks, monetization and MVP. No market research is performed; assumptions are labelled.')}
            prompt={`Validate my idea "${idea.title}".`} buttonLabel={idea.ai_validation ? 'Validate again' : 'Validate this idea'}
            onResult={(r) => setFresh(r.reply)} />
          {fresh && (
            <Button variant="secondary" onClick={saveValidation} loading={saving}>{tr('Save this validation to the idea')}</Button>
          )}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 border-t border-slate-100 pt-1 dark:border-white/5">
        <ConvertButton kind="idea_to_project" source={idea} />
        <ConvertButton kind="idea_to_task" source={idea} />
      </div>
    </Card>
  )
}

export function makeBrainstormConfig() {
  return {
    table: 'ideas',
    title: 'Brainstorm',
    subtitle: 'Capture ideas and turn them into projects.',
    singular: 'idea',
    icon: Lightbulb,
    lookups: ['projects'],
    order: [{ column: 'created_at', ascending: false }],
    fields: (l) => [
      { name: 'title', label: 'Idea title', required: true },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'category', label: 'Category', placeholder: 'For example: agriculture, software', half: true },
      { name: 'potential', label: 'Potential', type: 'select', options: IDEA_POTENTIAL, half: true },
      { name: 'status', label: 'Status', type: 'select', required: true, options: IDEA_STATUSES, half: true },
      { name: 'project_id', label: 'Project', type: 'select', options: l.options.projects || [], half: true },
      { name: 'problem', label: 'Problem', type: 'textarea', placeholder: 'What problem does this solve?' },
      { name: 'proposed_solution', label: 'Proposed solution', type: 'textarea' },
      { name: 'target_users', label: 'Target users' },
      { name: 'business_opportunity', label: 'Business opportunity', type: 'textarea' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
      { name: 'next_action', label: 'Next action', placeholder: 'The very next step' },
    ],
    defaults: () => ({ status: 'idea' }),
    empty: { title: 'Start adding your ideas', text: 'Capture the problem, the solution and the next step while it is fresh.', action: 'Add an idea' },
    search: ['title', 'description', 'problem', 'proposed_solution', 'notes', 'category'],
    filter: { field: 'status', options: IDEA_STATUSES },
    renderItem: (idea, actions) => <IdeaCard idea={idea} actions={actions} />,
  }
}

export default function Brainstorm() {
  const config = useMemo(makeBrainstormConfig, [])
  return <ResourcePage config={config} />
}
