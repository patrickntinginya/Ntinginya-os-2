import { useMemo, useState } from 'react'
import { useSnapshot } from '../../hooks/useSnapshot'
import Card from '../ui/Card'
import Button from '../ui/Button'
import Badge from '../ui/Badge'
import Spinner from '../ui/Spinner'
import ErrorState from '../ui/ErrorState'
import ProgressBar from '../ui/ProgressBar'
import { todayISO } from '../../utils/date'
import { formatMoney } from '../../utils/format'
import { savingsPlan } from '../../utils/metrics'
import {
  budgetForecasts, canAfford, financeAlerts, monthlySavingsCommitment, unusualSpending, upcomingRecurringExpenses,
} from '../../utils/financeIntel'
import { tr } from '../../i18n'

const KEYS = ['totals', 'monthly', 'catThis', 'catPrev', 'budgets', 'recurring', 'savingsGoals']
const VERDICT = {
  affordable: { tone: 'brand', label: 'Affordable' },
  risky: { tone: 'warn', label: 'Risky' },
  not_recommended: { tone: 'danger', label: 'Not recommended' },
}

function Section({ title, children, note }) {
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      {children}
      {note && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{note}</p>}
    </Card>
  )
}

function AffordForm({ ctx }) {
  const [raw, setRaw] = useState('')
  const [result, setResult] = useState(null)

  const check = (e) => {
    e.preventDefault()
    setResult(canAfford({ amount: Number(raw.replace(/[,\s]/g, '')), ...ctx }))
  }

  return (
    <Section
      title={tr('Can I afford this?')}
      note={tr('This is a simple calculation from the numbers you recorded. It is general guidance, not professional financial advice.')}
    >
      <form onSubmit={check} className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="afford-amount" className="label">{tr('Amount I want to spend (TSh)')}</label>
          <input id="afford-amount" className="input" inputMode="numeric" placeholder="250000" value={raw} onChange={(e) => { setRaw(e.target.value); setResult(null) }} />
        </div>
        <Button type="submit" disabled={!raw.trim()} className="sm:self-end">{tr('Check')}</Button>
      </form>

      {result && (
        <div className="mt-4" aria-live="polite">
          {VERDICT[result.verdict] && <Badge tone={VERDICT[result.verdict].tone}>{tr(VERDICT[result.verdict].label)}</Badge>}
          <p className="mt-2 text-sm">{result.message}</p>
          {result.steps.length > 0 && (
            <dl className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm dark:divide-white/5 dark:border-white/10">
              {result.steps.map((s) => (
                <div key={s.label} className={`flex items-center justify-between gap-3 px-3 py-2 ${s.total ? 'font-semibold' : ''}`}>
                  <dt>{tr(s.label)}</dt>
                  <dd className="tabular-nums">{s.value < 0 ? '-' : ''}{formatMoney(Math.abs(s.value))}</dd>
                </div>
              ))}
            </dl>
          )}
          {result.warnings?.map((w) => <p key={w} className="mt-2 text-sm text-amber-700 dark:text-amber-300">{w}</p>)}
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {tr("Rule used: affordable if the purchase is at most half of this month's free cash, risky if it is more than half but still fits, not recommended if it does not fit.")}
          </p>
        </div>
      )}
    </Section>
  )
}

export default function IntelligenceTab() {
  const { data, errors, loading, reload } = useSnapshot(KEYS)
  const today = todayISO()

  const view = useMemo(() => {
    const monthly = data.monthly || []
    const now = monthly[monthly.length - 1] || { income: 0, expenses: 0 }
    const catThis = data.catThis || []
    const catPrev = data.catPrev || []
    const budgets = data.budgets || []
    const forecasts = budgetForecasts(budgets, catThis, today)
    const upcoming = upcomingRecurringExpenses(data.recurring || [], today)
    const plans = (data.savingsGoals || []).filter((g) => g.status === 'active').map((g) => savingsPlan(g, today))
    return {
      now, forecasts, upcoming,
      unusual: unusualSpending(catThis, catPrev, today),
      alerts: financeAlerts({ monthIncome: now.income, monthExpenses: now.expenses, budgets, catThis, catPrev, today }),
      afford: {
        monthIncome: now.income,
        monthExpenses: now.expenses,
        upcomingRecurring: upcoming.total,
        savingsCommitment: monthlySavingsCommitment(plans),
        balance: data.totals ? data.totals.income - data.totals.expenses : null,
        budgetRemaining: forecasts.length ? forecasts.reduce((t, f) => t + Math.max(0, f.remaining), 0) : null,
      },
    }
  }, [data, today])

  if (loading) return <Spinner />
  const firstError = Object.values(errors)[0]
  if (firstError && !data.totals) return <ErrorState message={firstError} onRetry={reload} />

  return (
    <div className="space-y-4">
      <Section title={tr('This month')} note={tr('Calculated from your recorded income, expenses and budgets. No AI is used here.')}>
        {view.alerts.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{tr('Not enough data yet. Record income, expenses or budgets this month.')}</p>
        ) : (
          <ul className="space-y-2 text-sm">{view.alerts.map((a) => <li key={a}>{a}</li>)}</ul>
        )}
      </Section>

      <Section title={tr('Budget forecast')} note={tr('Forecast = spent so far / days passed x days in month. It needs at least 3 days of the month.')}>
        {view.forecasts.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{tr('No budgets for this month. Create one in the Budgets tab.')}</p>
        ) : (
          <ul className="space-y-4">
            {view.forecasts.map((f) => (
              <li key={f.category}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="font-medium">{f.category}</span>
                  <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{formatMoney(f.spent)} {tr('of')} {formatMoney(f.budget)}</span>
                </div>
                <ProgressBar value={Math.min(100, f.percent)} label={`${f.category} budget used`} />
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {f.projected == null
                    ? tr('Forecast available after a few days of spending.')
                    : f.overBy > 0
                      ? `On pace to reach ${formatMoney(f.projected)}, about ${formatMoney(f.overBy)} over budget.`
                      : `On pace to reach ${formatMoney(f.projected)}, within budget.`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={tr('Unusual spending')}>
        {view.unusual.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{tr('Nothing unusual found compared with last month (or not enough data yet).')}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {view.unusual.map((u) => (
              <li key={u.category}><strong>{u.category}</strong>{tr(': on pace for')} {formatMoney(u.projected)}, {u.ratio}{tr('x last month (')}{formatMoney(u.lastMonth)}).</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={tr('Recurring expenses still to come this month')}>
        {view.upcoming.items.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{tr('None scheduled for the rest of this month.')}</p>
        ) : (
          <>
            <ul className="space-y-1 text-sm">
              {view.upcoming.items.map((i, k) => (
                <li key={`${i.date}-${k}`} className="flex justify-between gap-3"><span>{i.category} ({i.date})</span><span className="tabular-nums">{formatMoney(i.amount)}</span></li>
              ))}
            </ul>
            <p className="mt-2 text-sm font-semibold">{tr('Total')} {formatMoney(view.upcoming.total)}</p>
          </>
        )}
      </Section>

      <AffordForm ctx={view.afford} />
    </div>
  )
}
