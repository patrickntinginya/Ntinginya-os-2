import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { db } from '../../services/db'
import { useLookups } from '../../hooks/useLookups'
import MonthPicker from '../ui/MonthPicker'
import Card from '../ui/Card'
import Button from '../ui/Button'
import Spinner from '../ui/Spinner'
import ErrorState from '../ui/ErrorState'
import EmptyState from '../ui/EmptyState'
import ConfirmDialog from '../ui/ConfirmDialog'
import ItemActions from '../ui/ItemActions'
import RecordForm from '../RecordForm'
import { addMonths, startOfMonth, startOfNextMonth, todayISO } from '../../utils/date'
import { formatMoney, friendlyError } from '../../utils/format'
import { budgetUsage } from '../../utils/metrics'
import { labelOf } from '../../lib/constants'
import { Wallet } from 'lucide-react'
import { tr } from '../../i18n'

const LEVEL = {
  ok: { bar: 'bg-brand-500', text: '' },
  warning: { bar: 'bg-amber-500', text: 'Warning: 70% or more used' },
  critical: { bar: 'bg-orange-600', text: 'Warning: 90% or more used' },
  over: { bar: 'bg-red-600', text: 'Over budget' },
}

export default function BudgetsTab() {
  const thisMonth = startOfMonth(todayISO())
  const [month, setMonth] = useState(thisMonth)
  const [budgets, setBudgets] = useState([])
  const [spent, setSpent] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(null)
  const [toDelete, setToDelete] = useState(null)
  const [copyBusy, setCopyBusy] = useState(false)
  const lookups = useLookups(['expense_categories'])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [b, s] = await Promise.all([
        db.list('budgets', { filters: [{ op: 'eq', column: 'month', value: month }], order: [{ column: 'created_at', ascending: true }] }),
        db.rpc('finance_expense_by_category', { p_from: month, p_to: startOfNextMonth(month) }),
      ])
      setBudgets(b)
      setSpent((s || []).map((r) => ({ category: r.category, amount: Number(r.total) || 0 })))
      setError(null)
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setLoading(false)
    }
  }, [month])
  useEffect(() => { load() }, [load])

  const usage = useMemo(() => budgetUsage(budgets, spent), [budgets, spent])
  const byId = useMemo(() => Object.fromEntries(budgets.map((b) => [b.id, b])), [budgets])
  const totals = useMemo(() => ({ budget: usage.reduce((t, u) => t + u.budget, 0), spent: usage.reduce((t, u) => t + u.spent, 0) }), [usage])

  const fields = [
    { name: 'category', label: 'Category', type: 'select', required: true, options: lookups.options.expense_categories || [], hint: 'Pick a category, or add your own in the Categories tab.' },
    { name: 'amount', label: 'Monthly budget (TSh)', type: 'number', required: true, step: '1', min: '1', cast: 'number' },
  ]
  const save = async (v) => {
    if (form.item) await db.update('budgets', form.item.id, { amount: v.amount, category: v.category })
    else await db.create('budgets', { ...v, month })
    await load()
  }
  const copyLast = async () => {
    setCopyBusy(true)
    try {
      const prev = await db.list('budgets', { filters: [{ op: 'eq', column: 'month', value: addMonths(month, -1) }] })
      for (const p of prev) await db.create('budgets', { category: p.category, amount: p.amount, month })
      await load()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setCopyBusy(false)
    }
  }

  return (
    <div>
      <MonthPicker month={month} onChange={setMonth} maxMonth={addMonths(thisMonth, 1)} />
      <div className="mb-4 flex justify-end"><Button onClick={() => setForm({})}><Plus size={20} aria-hidden="true" /> {tr('Add budget')}</Button></div>
      {loading ? <Spinner /> : error ? <ErrorState message={error} onRetry={load} /> : usage.length === 0 ? (
        <EmptyState icon={Wallet} title={tr('No budgets for this month')} text={tr('Set a monthly limit for a category to see how much you have left.')}
          action={<div className="flex flex-wrap justify-center gap-2"><Button onClick={() => setForm({})}>{tr('Add a budget')}</Button><Button variant="secondary" onClick={copyLast} loading={copyBusy}>{tr('Copy last month\'s budgets')}</Button></div>} />
      ) : (
        <div className="space-y-3">
          <Card className="p-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">{tr('All budgets')}</p>
            <p className="mt-1 font-semibold tabular-nums">{formatMoney(totals.spent)} {tr('of')} {formatMoney(totals.budget)} {tr('spent')}</p>
          </Card>
          {usage.map((u) => (
            <Card key={u.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{labelOf([], u.category)}</p>
                  <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300 tabular-nums">{tr('Budget:')} {formatMoney(u.budget)}</p>
                </div>
                <ItemActions label={`${labelOf([], u.category)} budget`} onEdit={() => setForm({ item: byId[u.id] })} onDelete={() => setToDelete(byId[u.id])} />
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10" role="progressbar" aria-valuenow={Math.min(100, u.percent)} aria-valuemin={0} aria-valuemax={100} aria-label={`${labelOf([], u.category)} budget used`}>
                <div className={`h-full rounded-full ${LEVEL[u.level].bar}`} style={{ width: `${Math.min(100, u.percent)}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 text-sm tabular-nums">
                <span>{tr('Spent:')} {formatMoney(u.spent)} ({u.percent}%)</span>
                <span className={u.remaining < 0 ? 'font-semibold text-red-600 dark:text-red-400' : ''}>{u.remaining < 0 ? tr('Over by') : tr('Remaining:')} {formatMoney(Math.abs(u.remaining))}</span>
              </div>
              {LEVEL[u.level].text && <p className={`mt-1 text-sm font-medium ${u.level === 'over' ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-300'}`}>{LEVEL[u.level].text}</p>}
            </Card>
          ))}
        </div>
      )}
      {form && <RecordForm title={`${form.item ? 'Edit' : 'New'} budget`} fields={fields} initial={form.item} onSubmit={save} onClose={() => setForm(null)} />}
      {toDelete && <ConfirmDialog title={tr('Delete budget?')} message={`The ${labelOf([], toDelete.category)} budget for this month will be deleted. Your expenses are not affected.`} onConfirm={async () => { await db.remove('budgets', toDelete.id); await load() }} onClose={() => setToDelete(null)} />}
    </div>
  )
}
