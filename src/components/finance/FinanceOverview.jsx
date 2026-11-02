import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { useSnapshot } from '../../hooks/useSnapshot'
import Card from '../ui/Card'
import StatCard from '../ui/StatCard'
import Button from '../ui/Button'
import Spinner from '../ui/Spinner'
import ErrorState from '../ui/ErrorState'
import EmptyState from '../ui/EmptyState'
import BarChart from '../charts/BarChart'
import LineChart from '../charts/LineChart'
import HBarList from '../charts/HBarList'
import AskAiPanel, { FINANCE_DISCLAIMER } from '../ai/AskAiPanel'
import { db } from '../../services/db'
import { formatMonthShort, formatMonth } from '../../utils/date'
import { formatMoney, friendlyError } from '../../utils/format'
import { budgetUsage, savingsRate, totalsByCategory } from '../../utils/metrics'
import { financeObservations } from '../../utils/review'
import { labelOf } from '../../lib/constants'
import { Wallet } from 'lucide-react'
import { tr } from '../../i18n'

const KEYS = ['totals', 'monthly', 'catThis', 'catPrev', 'budgets']

const Section = ({ title, children, note }) => (
  <Card className="p-4">
    <h2 className="mb-3 text-base font-semibold">{title}</h2>
    {children}
    {note && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{note}</p>}
  </Card>
)
const NotEnough = ({ text = 'Not enough data yet. This chart appears once you have records in at least two months.' }) => (
  <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-white/5 dark:text-slate-400">{text}</p>
)

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`

export default function FinanceOverview() {
  const { data, errors, loading, reload } = useSnapshot(KEYS)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)

  const view = useMemo(() => {
    const monthly = data.monthly || []
    const now = monthly[monthly.length - 1] || { income: 0, expenses: 0 }
    const catRows = (data.catThis || []).map((c) => ({ category: c.category, amount: c.amount }))
    const usage = budgetUsage(data.budgets || [], catRows)
    return {
      monthly, now,
      balance: (data.totals?.income || 0) - (data.totals?.expenses || 0),
      savings: now.income - now.expenses,
      rate: savingsRate(now.income, now.expenses),
      budgetLeft: usage.reduce((t, u) => t + u.remaining, 0),
      usage,
      cats: totalsByCategory(catRows),
      monthsWithData: monthly.filter((m) => m.income > 0 || m.expenses > 0),
      observations: financeObservations({ monthly, catThis: catRows, catPrev: (data.catPrev || []).map((c) => ({ category: c.category, amount: c.amount })), budgets: data.budgets || [] }),
    }
  }, [data])

  const exportCsv = async () => {
    setExporting(true)
    setExportError(null)
    try {
      const [income, expenses] = await Promise.all([
        db.list('income', { order: [{ column: 'entry_date', ascending: false }], limit: 5000 }),
        db.list('expenses', { order: [{ column: 'entry_date', ascending: false }], limit: 5000 }),
      ])
      const rows = [
        ['Date', 'Type', 'Category', 'Source', 'Amount (TZS)', 'Notes'],
        ...income.map((r) => [r.entry_date, 'Income', r.category, r.source, r.amount, r.notes]),
        ...expenses.map((r) => [r.entry_date, 'Expense', r.category, '', r.amount, r.notes]),
      ].sort((a, b) => (a[0] === 'Date' ? -1 : b[0] === 'Date' ? 1 : String(b[0]).localeCompare(String(a[0]))))
      const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `finance-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setExportError(friendlyError(e))
    } finally {
      setExporting(false)
    }
  }

  if (loading) return <Spinner />
  const failed = ['totals', 'monthly'].map((k) => errors[k]).find(Boolean)
  if (failed) return <ErrorState message={failed} onRetry={reload} />

  const empty = !view.monthsWithData.length && !(data.totals?.income || data.totals?.expenses)
  if (empty) {
    return <EmptyState icon={Wallet} title={tr('No financial records yet')} text={tr('Your financial data will appear here. Add income or an expense in the Transactions tab.')} />
  }

  const { monthly, now } = view
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label={tr('Current balance')} value={formatMoney(view.balance)} tone={view.balance < 0 ? 'negative' : undefined} hint={tr('All income minus all expenses')} />
        <StatCard label={tr('Income this month')} value={formatMoney(now.income)} />
        <StatCard label={tr('Expenses this month')} value={formatMoney(now.expenses)} />
        <StatCard label={tr('Savings this month')} value={formatMoney(view.savings)} tone={view.savings < 0 ? 'negative' : 'positive'} hint={view.rate == null ? 'No income recorded yet' : `${view.rate}% of income`} />
        <StatCard label={tr('Budget remaining')} value={view.usage.length ? formatMoney(view.budgetLeft) : 'No budgets set'} tone={view.usage.length && view.budgetLeft < 0 ? 'negative' : undefined} />
      </div>

      <Section title={tr('What the numbers show')} note={tr('Plain facts calculated from your records.')}>
        <ul className="space-y-2 text-[15px]">{view.observations.map((o) => <li key={o}>{o}</li>)}</ul>
      </Section>

      <Section title={tr('Income vs expenses')}>
        {view.monthsWithData.length >= 2 ? (
          <BarChart data={monthly.map((m) => ({ label: formatMonthShort(m.month), values: [m.income, m.expenses] }))}
            series={[{ name: 'Income', className: 'bg-brand-500' }, { name: 'Expenses', className: 'bg-amber-500' }]}
            summary={`Income and expenses for the last ${monthly.length} months in TSh`} />
        ) : <NotEnough />}
      </Section>

      <Section title={tr('Spending by category')} note={formatMonth(monthly[monthly.length - 1].month)}>
        {view.cats.length ? <HBarList items={view.cats} /> : <NotEnough text={tr('No expenses recorded this month.')} />}
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title={tr('Monthly spending trend')}>
          {view.monthsWithData.length >= 2 ? <LineChart points={monthly.map((m) => ({ label: formatMonthShort(m.month), value: m.expenses }))} summary="Monthly expenses in TSh" /> : <NotEnough />}
        </Section>
        <Section title={tr('Savings trend (income minus expenses)')}>
          {view.monthsWithData.length >= 2 ? <LineChart points={monthly.map((m) => ({ label: formatMonthShort(m.month), value: m.income - m.expenses }))} summary="Monthly savings in TSh" /> : <NotEnough />}
        </Section>
      </div>

      <Section title={tr('Budget vs actual')}>
        {view.usage.length ? (
          <BarChart data={view.usage.slice(0, 8).map((u) => ({ label: labelOf([], u.category).slice(0, 8), values: [u.budget, u.spent] }))}
            series={[{ name: 'Budget', className: 'bg-slate-400' }, { name: 'Spent', className: 'bg-brand-600' }]} summary="Budget compared with actual spending this month in TSh" />
        ) : <NotEnough text={tr('No budgets set for this month. Create one in the Budgets tab.')} />}
      </Section>

      <Section title={tr('Monthly summary')}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead><tr className="text-left text-xs text-slate-500 dark:text-slate-400"><th className="py-1 pr-3 font-medium">{tr('Month')}</th><th className="py-1 pr-3 text-right font-medium">{tr('Income')}</th><th className="py-1 pr-3 text-right font-medium">{tr('Expenses')}</th><th className="py-1 pr-3 text-right font-medium">{tr('Savings')}</th><th className="py-1 text-right font-medium">{tr('Rate')}</th></tr></thead>
            <tbody>
              {[...monthly].reverse().map((m) => (
                <tr key={m.month} className="border-t border-slate-100 dark:border-white/5">
                  <td className="py-2 pr-3">{formatMonthShort(m.month)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(m.income)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(m.expenses)}</td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${m.income - m.expenses < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{formatMoney(m.income - m.expenses)}</td>
                  <td className="py-2 text-right tabular-nums">{savingsRate(m.income, m.expenses) == null ? '-' : `${savingsRate(m.income, m.expenses)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button variant="secondary" className="mt-3" onClick={exportCsv} loading={exporting}><Download size={18} aria-hidden="true" /> {tr('Export transactions (CSV)')}</Button>
        {exportError && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{exportError}</p>}
      </Section>

      <AskAiPanel title={tr('AI financial advisor')} mode="finance_advice" prompt={tr('Analyse my finances this month compared with last month and suggest practical ways to improve.')}
        description={tr('Reads your recorded income, expenses, budgets and savings goals.')} buttonLabel={tr('Analyse my finances')} disclaimer={FINANCE_DISCLAIMER} />
    </div>
  )
}
