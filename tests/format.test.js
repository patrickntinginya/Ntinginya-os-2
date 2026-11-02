import test from 'node:test'
import assert from 'node:assert/strict'
import { formatMoney, formatCompact, friendlyError, DEFAULT_CURRENCY } from '../src/utils/format.js'

test('default currency is TZS', () => assert.equal(DEFAULT_CURRENCY, 'TZS'))

test('TZS is displayed as TSh with comma grouping and no symbols from other currencies', () => {
  assert.equal(formatMoney(10000), 'TSh 10,000')
  assert.equal(formatMoney(250000), 'TSh 250,000')
  assert.equal(formatMoney(1500000), 'TSh 1,500,000')
  assert.equal(formatMoney('850000.00'), 'TSh 850,000')
  assert.equal(formatMoney(0), 'TSh 0')
  assert.equal(formatMoney(-5000), '-TSh 5,000')
  for (const bad of ['$', 'USD', '€', '£']) assert.ok(!formatMoney(123456).includes(bad))
})

test('formatMoney tolerates bad input', () => {
  assert.equal(formatMoney(null), 'TSh 0')
  assert.equal(formatMoney(undefined), 'TSh 0')
  assert.equal(formatMoney('abc'), 'TSh 0')
})

test('compact axis labels', () => {
  assert.equal(formatCompact(1500000), '1.5M')
  assert.equal(formatCompact(250000), '250K')
  assert.equal(formatCompact(900), '900')
})

test('raw database errors are never shown', () => {
  const raw = 'duplicate key value violates unique constraint "budgets_user_id_category_month_key"'
  assert.equal(friendlyError(new Error(raw)), 'That already exists.')
  const secret = friendlyError(new Error('select * from secret_table failed at node 10.0.0.5'))
  assert.equal(secret, 'Something went wrong. Please try again.')
  assert.ok(!secret.includes('secret_table'))
})
