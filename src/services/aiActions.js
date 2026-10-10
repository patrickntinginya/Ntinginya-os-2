import { supabase } from '../lib/supabase'
import { db } from './db'
import { ACTIONS, validateAction } from '../lib/ai/actions'
import { startOfMonth, todayISO } from '../utils/date'
import { friendlyError } from '../utils/format'

const strip = (values) => Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== undefined))

/** Runs an already-validated action using the signed-in user's rights (RLS applies). */
export async function executeAction(type, payload) {
  const checked = validateAction(type, payload)
  if (!checked.ok) throw new Error(checked.error)
  const v = checked.values
  const today = todayISO()

  if (ACTIONS[type].table) {
    const values = strip(v)
    if (type === 'record_expense' || type === 'record_income') values.entry_date ||= today
    if (type === 'create_budget') values.month ||= startOfMonth(today)
    return db.create(ACTIONS[type].table, values)
  }

  if (type === 'create_goal_plan') {
    let milestones = 0
    let tasks = 0
    try {
      for (const [i, m] of v.milestones.entries()) {
        await db.create('milestones', strip({ goal_id: v.goal_id, title: m.title, due_date: m.due_date, position: i }))
        milestones++
        for (const t of m.tasks) {
          await db.create('tasks', strip({ title: t.title, due_date: t.due_date, priority: t.priority, goal_id: v.goal_id, notes: `Milestone: ${m.title}` }))
          tasks++
        }
      }
    } catch (e) {
      throw new Error(`Only part of the plan was saved (${milestones} milestones, ${tasks} tasks). ${friendlyError(e)}`)
    }
    return { milestones, tasks }
  }

  if (type === 'create_learning_plan') {
    const item = await db.create('learning_items', strip({
      topic: v.topic, description: v.description, learning_goal: v.learning_goal, target_date: v.target_date, status: 'not_started',
    }))
    let tasks = 0
    try {
      for (const s of v.steps) {
        await db.create('tasks', strip({ title: s.title, due_date: s.due_date, category: 'learning', notes: `Learning plan: ${v.topic}` }))
        tasks++
      }
    } catch (e) {
      throw new Error(`The topic was saved but only ${tasks} of ${v.steps.length} step tasks were. ${friendlyError(e)}`)
    }
    return { item, tasks }
  }

  throw new Error('Unknown action')
}

/**
 * Confirm = claim the request (pending -> confirmed) FIRST, so a double tap can never run it twice,
 * then execute. If execution fails the request is marked failed and the error is shown.
 */
export async function confirmAction(request) {
  const { data: claimed, error } = await supabase
    .from('ai_action_requests')
    .update({ status: 'confirmed', resolved_at: new Date().toISOString() })
    .eq('id', request.id)
    .eq('status', 'pending')
    .select()
  if (error) throw error
  if (!claimed?.length) throw new Error('This action was already handled.')
  try {
    await executeAction(request.action_type, request.payload)
  } catch (e) {
    await supabase.from('ai_action_requests').update({ status: 'failed', error: String(e.message || '').slice(0, 300) }).eq('id', request.id)
    throw e
  }
}

export async function cancelAction(request) {
  const { error } = await supabase
    .from('ai_action_requests')
    .update({ status: 'cancelled', resolved_at: new Date().toISOString() })
    .eq('id', request.id)
    .eq('status', 'pending')
  if (error) throw error
}
