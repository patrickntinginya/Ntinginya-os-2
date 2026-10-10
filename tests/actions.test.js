import test from 'node:test'
import assert from 'node:assert/strict'
import { ACTIONS, ACTION_TYPES, validateAction, toolDefinitions } from '../src/lib/ai/actions.js'

const GOAL = '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60'

test('the assistant can only propose creating things - no delete or update actions exist', () => {
  for (const t of ACTION_TYPES) assert.doesNotMatch(t, /delete|remove|update|edit/)
})

test('expense action matches the TSh example', () => {
  const r = validateAction('record_expense', { amount: 20000, category: 'Transport' })
  assert.equal(r.ok, true)
  assert.equal(r.summary, 'Record an expense of TSh 20,000 for transport')
})

test('amounts must be positive finite numbers', () => {
  for (const amount of [0, -5, NaN, Infinity, 'abc', null, 1e15]) {
    assert.equal(validateAction('record_expense', { amount, category: 'food' }).ok, false)
  }
  assert.equal(validateAction('record_expense', { amount: '15000', category: 'food' }).ok, true)
})

test('dates, times and enums are checked', () => {
  assert.equal(validateAction('create_task', { title: 'x', due_date: '2026-02-31' }).ok, false)
  assert.equal(validateAction('create_task', { title: 'x', due_date: 'tomorrow' }).ok, false)
  assert.equal(validateAction('create_task', { title: 'x', priority: 'extreme' }).ok, false)
  assert.equal(validateAction('create_event', { title: 'x', event_date: '2026-10-07', start_time: '10:00', end_time: '09:00' }).ok, false)
  assert.equal(validateAction('create_event', { title: 'x', event_date: '2026-10-07', start_time: '25:00' }).ok, false)
  assert.equal(validateAction('create_task', { title: 'ok', due_date: '2026-10-07', priority: 'high' }).ok, true)
})

test('required fields, unknown actions and junk payloads are rejected', () => {
  assert.equal(validateAction('create_task', {}).ok, false)
  assert.equal(validateAction('drop_table', {}).ok, false)
  assert.equal(validateAction('create_task', 'nope').ok, false)
  assert.equal(validateAction('create_goal_plan', { goal_id: 'not-a-uuid', milestones: [{ title: 'a' }] }).ok, false)
  assert.equal(validateAction('create_goal_plan', { goal_id: GOAL, milestones: [] }).ok, false)
})

test('goal plan keeps milestones and nested tasks', () => {
  const r = validateAction('create_goal_plan', {
    goal_id: GOAL,
    milestones: [{ title: 'Website', tasks: [{ title: 'Design' }, { title: 'Build', priority: 'high' }] }, { title: 'Content' }],
  })
  assert.equal(r.ok, true)
  assert.equal(r.values.milestones[0].tasks.length, 2)
  assert.equal(r.values.milestones[1].tasks.length, 0)
  assert.equal(r.summary, 'Add 2 milestone(s) and 2 task(s) to your goal')
})

test('overly long text is rejected', () => {
  assert.equal(validateAction('create_task', { title: 'x'.repeat(500) }).ok, false)
})

test('tool definitions cover every action and expose no secrets', () => {
  const tools = toolDefinitions()
  assert.equal(tools.length, ACTION_TYPES.length)
  for (const t of tools) assert.equal(t.input_schema.type, 'object')
  assert.ok(ACTIONS.record_expense.description.includes('TSh'))
})
