import { useMemo, useState } from 'react'
import { PiggyBank, Calendar } from 'lucide-react'
import ResourcePage from '../ResourcePage'
import RecordForm from '../RecordForm'
import Card from '../ui/Card'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import ProgressBar from '../ui/ProgressBar'
import ItemActions from '../ui/ItemActions'
import { formatDate, todayISO } from '../../utils/date'
import { formatMoney, pct } from '../../utils/format'
import { savingsPlan } from '../../utils/metrics'
import { tr } from '../../i18n'

function SavingsCard({ goal, actions }) {
  const [adding, setAdding] = useState(false)
  const plan = savingsPlan(goal, todayISO())
  const target = Number(goal.target_amount)
  const current = Number(goal.current_amount)
  const contribute = async (v) => {
    const next = current + v.amount
    await actions.update({ current_amount: next, status: next >= target ? 'completed' : goal.status })
  }
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{goal.name}</p>
          {goal.notes && <p className="mt-0.5 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{goal.notes}</p>}
        </div>
        <ItemActions label={goal.name} onEdit={actions.edit} onDelete={actions.remove} />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm tabular-nums">
        <div><dt className="text-xs text-slate-500 dark:text-slate-400">{tr('Target')}</dt><dd className="font-semibold">{formatMoney(target, goal.currency)}</dd></div>
        <div><dt className="text-xs text-slate-500 dark:text-slate-400">{tr('Saved')}</dt><dd className="font-semibold">{formatMoney(current, goal.currency)}</dd></div>
        <div><dt className="text-xs text-slate-500 dark:text-slate-400">{tr('Remaining')}</dt><dd className="font-semibold">{formatMoney(plan.remaining, goal.currency)}</dd></div>
      </dl>
      <div className="mt-3"><ProgressBar value={pct(current, target)} label={`${goal.name} saved`} /></div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {goal.status !== 'active' && <Badge tone={goal.status === 'completed' ? 'brand' : 'warn'}>{goal.status === 'completed' ? tr('Completed') : tr('Paused')}</Badge>}
        {goal.target_date && <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"><Calendar size={14} aria-hidden="true" /> {formatDate(goal.target_date)}</span>}
      </div>
      {goal.status === 'active' && plan.monthly != null && (
        <p className="mt-2 rounded-xl bg-brand-50 p-3 text-sm text-brand-900 dark:bg-brand-500/15 dark:text-brand-100">
          {tr('To reach this by')} {formatDate(goal.target_date)}{tr(': about')} {formatMoney(plan.monthly)} {tr('per month or')} {formatMoney(plan.weekly)} {tr('per week.')}
        </p>
      )}
      {goal.status === 'active' && plan.passed && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{tr('The target date has passed. Edit the goal to set a new date.')}</p>}
      {goal.status === 'active' && plan.noDate && <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{tr('Add a target date to see how much to save each month.')}</p>}
      {goal.status === 'active' && <Button variant="secondary" className="mt-3 w-full sm:w-auto" onClick={() => setAdding(true)}>{tr('Add savings')}</Button>}
      {adding && <RecordForm title={`Add to ${goal.name}`} fields={[{ name: 'amount', label: 'Amount saved (TSh)', type: 'number', required: true, step: '1', min: '1', cast: 'number' }]}
        validate={(v) => (Number(v.amount) > 0 ? null : 'Enter an amount greater than zero.')} onSubmit={contribute} onClose={() => setAdding(false)} />}
    </Card>
  )
}

const config = {
  table: 'financial_goals', singular: 'savings goal', title: 'Savings goals', icon: PiggyBank,
  order: [{ column: 'created_at', ascending: false }],
  fields: [
    { name: 'name', label: 'Goal', required: true, placeholder: 'For example: Buy a laptop' },
    { name: 'target_amount', label: 'Target (TSh)', type: 'number', required: true, step: '1', min: '1', half: true, cast: 'number' },
    { name: 'current_amount', label: 'Saved so far (TSh)', type: 'number', required: true, step: '1', min: '0', half: true, cast: 'number' },
    { name: 'target_date', label: 'Target date', type: 'date', half: true },
    { name: 'status', label: 'Status', type: 'select', required: true, half: true, options: [{ value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' }, { value: 'paused', label: 'Paused' }] },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ],
  defaults: () => ({ current_amount: 0, status: 'active' }),
  validate: (v) => (Number(v.target_amount) > 0 ? (Number(v.current_amount) < 0 ? 'Saved amount cannot be negative.' : null) : 'Enter a target greater than zero.'),
  empty: { title: 'No savings goals yet', text: 'Set a target, such as a laptop or an emergency fund, and track what you save.', action: 'Add a savings goal' },
  itemLabel: (i) => i.name,
  renderItem: (goal, actions) => <SavingsCard goal={goal} actions={actions} />,
}

export default function SavingsTab() {
  const cfg = useMemo(() => config, [])
  return <ResourcePage config={cfg} embedded />
}
