import { tr } from '../i18n/index.js'
// Plain-language, fact-only observations for the reviews. Every sentence is built from numbers passed in.
import { budgetUsage, totalsByCategory } from './metrics.js'
import { formatMoney } from './format.js'
import { labelOf } from '../lib/constants.js'

export function financeObservations({ monthly = [], catThis = [], catPrev = [], budgets = [] }) {
  const out = []
  const now = monthly[monthly.length - 1]
  const prev = monthly[monthly.length - 2]
  if (!now || (now.income === 0 && now.expenses === 0)) {
    if (!prev || (prev.income === 0 && prev.expenses === 0)) return [tr('Not enough data yet.')]
  }
  if (now && now.expenses === 0) out.push(tr('No expenses recorded this month.'))
  else if (now) {
    out.push(tr('So far this month you have spent {spent}{extra}.', { spent: formatMoney(now.expenses), extra: prev && prev.expenses > 0 ? tr('; last month\'s full total was {formatMoney}', { formatMoney: formatMoney(prev.expenses) }) : '' }))
  }
  if (now && now.income > 0) out.push(tr('Income this month is {formatMoney}, leaving {formatMoney2}.', { formatMoney: formatMoney(now.income), formatMoney2: formatMoney(now.income - now.expenses) }))
  const top = totalsByCategory(catThis)[0]
  if (top) out.push(tr('{labelOf} is your largest expense category this month at {formatMoney}.', { labelOf: labelOf([], top.category), formatMoney: formatMoney(top.total) }))
  const prevMap = new Map(totalsByCategory(catPrev).map((c) => [c.category, c.total]))
  for (const c of totalsByCategory(catThis).slice(0, 5)) {
    const p = prevMap.get(c.category)
    if (p && c.total > p) out.push(tr('{labelOf} spending ({formatMoney}) has already passed last month\'s whole total ({formatMoney2}).', { labelOf: labelOf([], c.category), formatMoney: formatMoney(c.total), formatMoney2: formatMoney(p) }))
  }
  for (const u of budgetUsage(budgets, catThis)) {
    if (u.level === 'over') out.push(tr('{labelOf} is over budget: {formatMoney} spent of {formatMoney2}.', { labelOf: labelOf([], u.category), formatMoney: formatMoney(u.spent), formatMoney2: formatMoney(u.budget) }))
    else if (u.level === 'critical' || u.level === 'warning') out.push(tr('{labelOf} budget is {percent}% used ({formatMoney} left).', { labelOf: labelOf([], u.category), percent: u.percent, formatMoney: formatMoney(u.remaining) }))
  }
  return out.length ? out : [tr('Not enough data yet.')]
}
