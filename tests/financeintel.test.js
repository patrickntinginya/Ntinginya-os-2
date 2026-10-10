import assert from 'node:assert/strict'
import test from 'node:test'
import { budgetForecasts, canAfford, financeAlerts, monthlySavingsCommitment, projectMonthEnd, unusualSpending, upcomingRecurringExpenses } from '../src/utils/financeIntel.js'

const TODAY = '2026-10-10'

test('month-end projection follows the pace so far', () => {
  assert.equal(projectMonthEnd(300000, TODAY), 930000) // 30,000/day * 31
})
test('no projection in the first days or with no spending', () => {
  assert.equal(projectMonthEnd(300000, '2026-10-02'), null)
  assert.equal(projectMonthEnd(0, TODAY), null)
})
test('budget forecast shows how much a budget may be exceeded', () => {
  const [f] = budgetForecasts([{ id: 'b', category: 'Food', amount: 200000 }], [{ category: 'Food', amount: 145000 }], TODAY)
  assert.equal(f.percent, 73)
  assert.equal(f.projected, 449500)
  assert.equal(f.overBy, 249500)
})
test('unusual spending: projected well above last month', () => {
  const r = unusualSpending([{ category: 'Transport', amount: 400000 }, { category: 'Food', amount: 5000 }], [{ category: 'transport', amount: 300000 }, { category: 'Food', amount: 9000 }], TODAY)
  assert.equal(r.length, 1)
  assert.equal(r[0].category, 'Transport')
  assert.equal(r[0].projected, 1240000)
})
test('unusual spending ignores small categories and categories with no history', () => {
  assert.deepEqual(unusualSpending([{ category: 'Airtime', amount: 5000 }, { category: 'New', amount: 900000 }], [{ category: 'Airtime', amount: 1000 }], TODAY), [])
})
test('recurring expenses still to come this month', () => {
  const r = upcomingRecurringExpenses([
    { kind: 'expense', amount: 300000, frequency: 'monthly', next_date: '2026-10-25', is_active: true },
    { kind: 'expense', amount: 10000, frequency: 'weekly', next_date: '2026-10-10', is_active: true }, // 10th is today, so 17, 24, 31
    { kind: 'income', amount: 999999, frequency: 'monthly', next_date: '2026-10-28', is_active: true },
    { kind: 'expense', amount: 5000, frequency: 'monthly', next_date: '2026-11-02', is_active: true },
  ], TODAY)
  assert.equal(r.total, 330000)
})
test('savings commitment sums monthly plans', () => {
  assert.equal(monthlySavingsCommitment([{ monthly: 100000 }, { remaining: 5 }, null, { monthly: 50000 }]), 150000)
})
const base = { monthIncome: 1500000, monthExpenses: 650000, upcomingRecurring: 100000, savingsCommitment: 200000 } // free cash 550,000
test('affordable when within half of free cash', () => {
  const r = canAfford({ ...base, amount: 250000 })
  assert.equal(r.verdict, 'affordable')
  assert.equal(r.freeCash, 550000)
  assert.equal(r.steps.at(-1).value, 300000)
})
test('risky when it uses more than half but fits', () => assert.equal(canAfford({ ...base, amount: 400000 }).verdict, 'risky'))
test('not recommended when above free cash', () => assert.equal(canAfford({ ...base, amount: 600000 }).verdict, 'not_recommended'))
test('not recommended when it exceeds the recorded balance', () => {
  const r = canAfford({ ...base, amount: 100000, balance: 50000 })
  assert.equal(r.verdict, 'not_recommended')
  assert.ok(r.warnings.length)
})
test('unknown with no data, invalid with bad input', () => {
  assert.equal(canAfford({ amount: 1000, monthIncome: 0, monthExpenses: 0 }).verdict, 'unknown')
  assert.equal(canAfford({ ...base, amount: -5 }).verdict, 'invalid')
})
test('alerts are plain TSh sentences from real numbers', () => {
  const a = financeAlerts({ monthIncome: 1000000, monthExpenses: 420000, budgets: [{ id: 'b', category: 'Food', amount: 100000 }], catThis: [{ category: 'Food', amount: 84000 }], catPrev: [], today: TODAY })
  assert.ok(a.includes('You have spent TSh 420,000 this month.'))
  assert.ok(a.some((x) => x.includes('84% of your Food budget')))
  assert.ok(a.some((x) => /may exceed the Food budget by about TSh/.test(x)))
})
