import { db } from './db'

/** Newest first. The database returns only the signed-in user's rows (RLS); user_id is never sent from the browser. */
export const listReflections = () =>
  db.list('reflections', { order: [{ column: 'entry_date', ascending: false }, { column: 'created_at', ascending: false }], limit: 500 })
export const createReflection = (values) => db.create('reflections', values)
export const updateReflection = (id, values) => db.update('reflections', id, values)
export const deleteReflection = (id) => db.remove('reflections', id)
