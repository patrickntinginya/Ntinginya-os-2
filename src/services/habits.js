import { supabase } from '../lib/supabase'

/** Marks a habit done (or not done) on one date. One entry per habit per day is enforced by the database. */
export async function setHabitDone(habitId, date, done) {
  if (done) {
    const { error } = await supabase.from('habit_entries').insert({ habit_id: habitId, entry_date: date })
    if (error && error.code !== '23505') throw error // 23505 = already marked: fine
  } else {
    const { error } = await supabase.from('habit_entries').delete().eq('habit_id', habitId).eq('entry_date', date)
    if (error) throw error
  }
}
