import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { CONVERSIONS, buildConversion } from '../src/utils/convert.js'
import { overdueMilestones, projectProgress, projectsNeedingAttention, rolledUpProgress } from '../src/utils/projects.js'

const TODAY = '2026-10-07'
const tk = (id, o = {}) => ({ id, title: id, status: 'todo', ...o })

test('project progress is the share of completed tasks, null with no tasks', () => {
  const p = { id: 'p' }
  assert.equal(projectProgress(p, []), null)
  assert.deepEqual(projectProgress(p, [tk('1', { project_id: 'p', status: 'completed' }), tk('2', { project_id: 'p' }), tk('3', { project_id: 'p', status: 'cancelled' }), tk('4', { project_id: 'other' })]), { done: 1, total: 2, percent: 50 })
})
test('goal progress rolls up: milestones, then tasks (incl. project tasks), then manual', () => {
  const goal = { id: 'g', progress: 33 }
  assert.deepEqual(rolledUpProgress(goal, {}), { percent: 33, source: 'manual' })
  const tasks = [tk('1', { goal_id: 'g', status: 'completed' }), tk('2', { project_id: 'p' }), tk('3', { project_id: 'p', status: 'completed' })]
  assert.deepEqual(rolledUpProgress(goal, { tasks, projects: [{ id: 'p', goal_id: 'g' }] }), { percent: 67, source: 'tasks' })
  assert.deepEqual(rolledUpProgress(goal, { tasks, milestones: [{ goal_id: 'g', is_done: true }, { goal_id: 'g', is_done: false }] }), { percent: 50, source: 'milestones' })
})
test('projects needing attention: deadline, overdue milestones, overdue tasks, nothing open', () => {
  const projects = [{ id: 'p1', name: 'A', status: 'active', deadline: '2026-10-05', goal_id: 'g' }, { id: 'p2', name: 'B', status: 'active' }, { id: 'p3', name: 'C', status: 'completed', deadline: '2020-01-01' }]
  const ms = [{ goal_id: 'g', is_done: false, due_date: '2026-10-01' }]
  assert.equal(overdueMilestones(projects[0], ms, TODAY).length, 1)
  const out = projectsNeedingAttention(projects, [tk('x', { project_id: 'p1', due_date: '2026-10-02' })], ms, TODAY)
  assert.deepEqual(out.map((o) => o.project.id), ['p1', 'p2'])
  assert.ok(out[0].reasons.some((r) => /Deadline passed 2 days ago/.test(r)))
  assert.ok(out[1].reasons.includes('No open tasks'))
})
test('conversions copy real fields and link back to the source record', () => {
  const idea = { id: 'i1', title: 'ShambaLetu', description: 'Farm marketplace', proposed_solution: 'App', next_action: 'Talk to 5 farmers' }
  assert.deepEqual(buildConversion('idea_to_project', idea).source_idea_id, 'i1')
  assert.equal(buildConversion('idea_to_project', idea).name, 'ShambaLetu')
  assert.equal(buildConversion('idea_to_task', idea).title, 'Talk to 5 farmers')
  assert.equal(buildConversion('note_to_task', { id: 'n', title: 'Call bank', content: 'x' }).source_note_id, 'n')
  assert.equal(buildConversion('learning_to_goal', { id: 'l', topic: 'React', target_date: '2026-12-01' }).name, 'Learn React')
  assert.equal(buildConversion('goal_to_project', { id: 'g', name: 'Build', target_date: '2026-12-31' }).deadline, '2026-12-31')
  assert.throws(() => buildConversion('nope', {}))
})
test('every conversion has a unique index in the database, so duplicates are impossible', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/003_v3.sql', import.meta.url), 'utf8')
  for (const [kind, c] of Object.entries(CONVERSIONS)) {
    const re = new RegExp(`create unique index[^;]*on public\\.${c.table} \\(${c.sourceColumn}\\)`)
    assert.match(sql, re, `${kind} needs a unique index on ${c.table}.${c.sourceColumn}`)
  }
})
