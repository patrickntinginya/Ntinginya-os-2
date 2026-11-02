import { supabase } from '../lib/supabase'
import { isMissingSchema } from './schemaErrors'
import { safeEntryRow } from '../utils/safeMode'

const unwrap = ({ data, error }) => {
  if (error) throw error
  return data
}

/** Active (not exited) plans for the signed-in user. Rows are limited to the owner by RLS. */
export async function listActivePlans() {
  return unwrap(await supabase.from('habit_safe_mode').select('*').is('exited_on', null).order('created_at', { ascending: false }).limit(200))
}

export async function startSafeMode(habitId, values) {
  return unwrap(await supabase.from('habit_safe_mode').insert({ habit_id: habitId, ...values }).select().single())
}

/** Updating the plan (smaller version / end date / note) keeps it active. */
export async function updatePlan(planId, values) {
  const { started_on, ...changes } = values // the start date of an existing plan never moves
  return unwrap(await supabase.from('habit_safe_mode').update(changes).eq('id', planId).select().single())
}

/** Leaves Safe Mode. The plan row is kept as a record; habit history is untouched. */
export async function exitSafeMode(planId, today) {
  return unwrap(await supabase.from('habit_safe_mode').update({ exited_on: today }).eq('id', planId).select().single())
}

/** Dates (per habit) on which the smaller version was logged. Empty when the V5 column does not exist yet. */
export async function listSafeDates() {
  const { data, error } = await supabase.from('habit_entries').select('habit_id,entry_date').eq('safe_mode', true).limit(2000)
  if (error) {
    if (isMissingSchema(error)) return new Map()
    throw error
  }
  const m = new Map()
  for (const r of data || []) {
    if (!m.has(r.habit_id)) m.set(r.habit_id, new Set())
    m.get(r.habit_id).add(String(r.entry_date).slice(0, 10))
  }
  return m
}

/** Records "I did the smaller version" as a normal habit entry flagged safe_mode. Already-recorded days are fine (23505). */
export async function logSafeCompletion(habitId, date) {
  const { error } = await supabase.from('habit_entries').insert(safeEntryRow(habitId, date))
  if (error && error.code !== '23505') throw error
}
