import { useMemo, useState } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import ResourcePage from '../ResourcePage'
import Tabs from '../ui/Tabs'
import Card from '../ui/Card'
import Badge from '../ui/Badge'
import ItemActions from '../ui/ItemActions'
import { labelOf } from '../../lib/constants'
import { formatDate, todayISO } from '../../utils/date'
import { formatMoney } from '../../utils/format'
import { tr } from '../../i18n'

function EntryCard({ entry, actions, kind }) {
  const isIncome = kind === 'income'
  const heading = isIncome ? entry.source || labelOf([], entry.category) || 'Income' : labelOf([], entry.category)
  return (
    <Card className="flex items-start gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{heading}</p>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{formatDate(entry.entry_date)}</p>
        {entry.notes && <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{entry.notes}</p>}
        {isIncome && entry.category && entry.source && <div className="mt-2"><Badge>{labelOf([], entry.category)}</Badge></div>}
      </div>
      <p className={`shrink-0 pt-0.5 font-semibold tabular-nums ${isIncome ? 'text-brand-700 dark:text-brand-300' : ''}`}>
        {isIncome ? '+' : '-'}{formatMoney(entry.amount, entry.currency)}
      </p>
      <ItemActions label={heading} onEdit={actions.edit} onDelete={actions.remove} />
    </Card>
  )
}

const order = [{ column: 'entry_date', ascending: false }, { column: 'created_at', ascending: false }]
const amountField = { name: 'amount', label: 'Amount (TSh)', type: 'number', required: true, step: '1', min: '1', half: true, cast: 'number', placeholder: '20000' }
const positive = (v) => (Number(v.amount) > 0 ? null : 'Enter an amount greater than zero.')

const expenseConfig = {
  table: 'expenses', singular: 'expense', icon: TrendingDown, order, lookups: ['expense_categories'],
  fields: (l) => [
    amountField,
    { name: 'entry_date', label: 'Date', type: 'date', required: true, half: true },
    { name: 'category', label: 'Category', type: 'select', required: true, options: l.options.expense_categories || [] },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ],
  defaults: () => ({ entry_date: todayISO(), category: 'other' }),
  empty: { title: 'No expenses recorded', text: 'Track what you spend to see where your money goes.', action: 'Add expense' },
  search: ['category', 'notes'],
  validate: positive,
  itemLabel: (i) => formatMoney(i.amount, i.currency),
  renderItem: (entry, actions) => <EntryCard entry={entry} actions={actions} kind="expense" />,
}
const incomeConfig = {
  table: 'income', singular: 'income', icon: TrendingUp, order, lookups: ['income_categories'],
  fields: (l) => [
    amountField,
    { name: 'entry_date', label: 'Date', type: 'date', required: true, half: true },
    { name: 'source', label: 'Source', placeholder: 'Who or what paid you?' },
    { name: 'category', label: 'Category', type: 'select', options: l.options.income_categories || [] },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ],
  defaults: () => ({ entry_date: todayISO() }),
  empty: { title: 'No income recorded', text: 'Record income to see your balance and savings.', action: 'Add income' },
  search: ['source', 'category', 'notes'],
  validate: positive,
  itemLabel: (i) => formatMoney(i.amount, i.currency),
  renderItem: (entry, actions) => <EntryCard entry={entry} actions={actions} kind="income" />,
}

export default function TransactionsTab() {
  const [kind, setKind] = useState('expenses')
  const cfg = useMemo(() => (kind === 'expenses' ? expenseConfig : incomeConfig), [kind])
  return (
    <div>
      <Tabs tabs={[{ value: 'expenses', label: 'Expenses' }, { value: 'income', label: 'Income' }]} value={kind} onChange={setKind} label={tr('Transaction type')} />
      <ResourcePage key={kind} config={cfg} embedded />
    </div>
  )
}
