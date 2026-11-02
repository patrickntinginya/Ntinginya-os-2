import { useMemo } from 'react'
import { Tags } from 'lucide-react'
import ResourcePage from '../ResourcePage'
import Card from '../ui/Card'
import Badge from '../ui/Badge'
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../../lib/constants'
import ItemActions from '../ui/ItemActions'
import { tr } from '../../i18n'

const defaults = (list) => new Set(list.map((c) => c.value))

const config = {
  table: 'finance_categories', singular: 'category', title: 'Custom categories', icon: Tags,
  order: [{ column: 'name', ascending: true }],
  fields: [
    { name: 'name', label: 'Name', required: true, placeholder: 'For example: Farm inputs' },
    { name: 'kind', label: 'Used for', type: 'select', required: true, options: [{ value: 'expense', label: 'Expenses' }, { value: 'income', label: 'Income' }] },
  ],
  defaults: () => ({ kind: 'expense' }),
  validate: (v) => {
    const name = String(v.name || '').trim().toLowerCase()
    if (!name) return 'Enter a name.'
    if (name.length > 40) return 'Use 40 characters or fewer.'
    return defaults(v.kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).has(name) ? 'That category already exists.' : null
  },
  empty: { title: 'No custom categories yet', text: 'The built-in categories are listed above. Add your own, such as Farm inputs.', action: 'Add a category' },
  itemLabel: (c) => c.name,
  renderItem: (c, actions) => (
    <Card className="flex items-center gap-3 p-4">
      <div className="min-w-0 flex-1"><p className="font-medium">{c.name}</p></div>
      <Badge>{c.kind === 'income' ? tr('Income') : tr('Expenses')}</Badge>
      <ItemActions label={c.name} onEdit={actions.edit} onDelete={actions.remove} />
    </Card>
  ),
}

export default function CategoriesTab() {
  const cfg = useMemo(() => config, [])
  return (
    <div>
      <Card className="mb-5 p-4">
        <h2 className="text-base font-semibold">{tr('Built-in categories')}</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{tr('Expenses')}</p>
        <div className="mt-1 flex flex-wrap gap-2">{EXPENSE_CATEGORIES.map((c) => <Badge key={c.value}>{tr(c.label)}</Badge>)}</div>
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{tr('Income')}</p>
        <div className="mt-1 flex flex-wrap gap-2">{INCOME_CATEGORIES.map((c) => <Badge key={c.value}>{tr(c.label)}</Badge>)}</div>
      </Card>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">{tr('Deleting a custom category does not change entries that already use it.')}</p>
      <ResourcePage config={cfg} embedded />
    </div>
  )
}
