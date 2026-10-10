import { supabase } from '../lib/supabase'
import { cleanTerm } from '../utils/searchTerm'

import { SOURCES } from '../lib/searchSources'

/** Searches the signed-in user's own rows (Row Level Security limits every query to the owner). */
export async function searchAll(raw) {
  const term = cleanTerm(raw)
  if (term.length < 2) return []
  const groups = await Promise.all(
    SOURCES.map(async (s) => {
      const { data, error } = await supabase.from(s.table).select('*').or(s.cols.map((c) => `${c}.ilike.%${term}%`).join(',')).limit(6)
      if (error) return { ...s, rows: [], failed: true }
      return { ...s, rows: data }
    }),
  )
  return groups.filter((g) => g.rows.length || g.failed)
}
