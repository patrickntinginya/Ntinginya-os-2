import { useMemo } from 'react'
import { Repeat } from 'lucide-react'
import ResourcePage from '../ResourcePage'
import Card from '../ui/Card'
import Badge from '../ui/Badge'
import ItemActions from '../ui/ItemActions'
import { resetRecurring } from '../../services/recurring'
import { formatDate, todayISO } from '../../utils/date'
import { formatMoney } from '../../utils/format'
import { labelOf } from '../../lib/constants'
import { tr } from '../../i18n'

const FREQ = [{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }]
const KINDS = [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]

function Card1({ r, actions }) {
  const isIncome = r.kind === 'income'
  return (
    <Card className="flex items-start gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{isIncome ? r.source || tr('Recurring income') : labelOf([], r.category)}</p>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{labelOf(FREQ, r.frequency)}{tr(', next')} {formatDate(r.next_date)}{r.end_date ? `, until ${formatDate(r.end_date)}` : ''}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={isIncome ? 'brand' : 'neutral'}>{isIncome ? tr('Income') : tr('Expense')}</Badge>
          {!r.is_active && <Badge tone="warn">{tr('Paused')}</Badge>}
        </div>
        <button type="button" onClick={() => actions.update({ is_active: !r.is_active })} className="mt-1 min-h-[44px] text-sm font-medium text-brand-700 dark:text-brand-300">{r.is_active ? tr('Pause') : tr('Resume')}</button>
      </div>
      <p className="shrink-0 pt-0.5 font-semibold tabular-nums">{isIncome ? '+' : '-'}{formatMoney(r.amount, r.currency)}</p>
      <ItemActions label={tr('recurring item')} onEdit={actions.edit} onDelete={actions.remove} />
    </Card>
  )
}

const config = {
  table: 'recurring_transactions', singular: 'recurring item', title: 'Recurring', icon: Repeat,
  lookups: ['expense_categories', 'income_categories'],
  order: [{ column: 'next_date', ascending: true }],
  onMutated: resetRecurring,
  fields: (l) => {
    const seen = new Set()
    const categories = [...(l.options.expense_categories || []), ...(l.options.income_categories || [])].filter((c) => !seen.has(c.value) && seen.add(c.value))
    return [
      { name: 'kind', label: 'Type', type: 'select', required: true, options: KINDS, half: true },
      { name: 'amount', label: 'Amount (TSh)', type: 'number', required: true, step: '1', min: '1', half: true, cast: 'number' },
      { name: 'category', label: 'Category', type: 'select', options: categories },
      { name: 'source', label: 'Source (income)', placeholder: 'Who pays you?' },
      { name: 'frequency', label: 'Repeats', type: 'select', required: true, options: FREQ, half: true },
      { name: 'next_date', label: 'First / next date', type: 'date', required: true, half: true },
      { name: 'end_date', label: 'Ends on', type: 'date', hint: 'Optional.' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ]
  },
  defaults: () => ({ kind: 'expense', frequency: 'monthly', next_date: todayISO() }),
  validate: (v) => (v.kind === 'expense' && !v.category ? 'Pick a category for a recurring expense.' : Number(v.amount) > 0 ? null : 'Enter an amount greater than zero.'),
  empty: { title: 'No recurring items', text: 'Add rent, a salary or any payment that repeats. Entries are created for you when due.', action: 'Add a recurring item' },
  itemLabel: (r) => formatMoney(r.amount, r.currency),
  renderItem: (r, actions) => <Card1 r={r} actions={actions} />,
}

export default function RecurringTab() {
  const cfg = useMemo(() => config, [])
  return (
    <div>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        {tr('Due items are turned into real income or expense entries when you open the app on or after their date. Nothing runs while the app is closed.')}
      </p>
      <ResourcePage config={cfg} embedded />
    </div>
  )
}
