import { supabase } from '../lib/supabase'
import { USER_TABLES } from '../lib/tables'

/**
 * Thin data-access layer. All UI talks to Supabase through here so tables,
 * ordering and error handling live in one place. Row Level Security does the
 * real access control on the server; user_id defaults to auth.uid() in the DB.
 */
function unwrap({ data, error }) {
  if (error) throw error
  return data
}

/** Lets the Android shell rebuild reminder alarms after reminders are written by any screen. Nothing listens on the web. */
function announce(table) {
  if (table === 'reminders' && typeof window !== 'undefined') window.dispatchEvent(new Event('life-os:reminders-changed'))
}

export const db = {
  async list(table, { order = [{ column: 'created_at', ascending: false }], limit, filters = [] } = {}) {
    let q = supabase.from(table).select('*')
    for (const f of filters) q = q[f.op](f.column, f.value)
    for (const o of order) q = q.order(o.column, { ascending: o.ascending, nullsFirst: o.nullsFirst ?? false })
    if (limit) q = q.limit(limit)
    return unwrap(await q)
  },

  async create(table, values) {
    const row = unwrap(await supabase.from(table).insert(values).select().single())
    announce(table)
    return row
  },

  async update(table, id, values) {
    const row = unwrap(await supabase.from(table).update(values).eq('id', id).select().single())
    announce(table)
    return row
  },

  async remove(table, id) {
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) throw error
    announce(table)
  },

  async rpc(name, args) {
    return unwrap(await supabase.rpc(name, args))
  },
}

export const TABLES = USER_TABLES

/** Reads a whole table in pages (the API returns at most 1000 rows per request). RLS limits it to the signed-in user. */
async function readAll(table) {
  let rows = []
  for (let from = 0; ; from += 1000) {
    const page = unwrap(await supabase.from(table).select('*').range(from, from + 999))
    rows = rows.concat(page)
    if (page.length < 1000) return rows
  }
}

export async function exportAllData() {
  const result = {}
  for (const table of TABLES) {
    result[table] = await readAll(table)
  }
  return { exported_at: new Date().toISOString(), ...result }
}
