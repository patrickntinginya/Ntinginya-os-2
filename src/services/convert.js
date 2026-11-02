import { supabase } from '../lib/supabase'
import { CONVERSIONS, buildConversion } from '../utils/convert'

/** Finds the record already created from this source (so converting twice never makes a duplicate). */
export async function findConverted(kind, sourceId) {
  const c = CONVERSIONS[kind]
  const { data, error } = await supabase.from(c.table).select('id').eq(c.sourceColumn, sourceId).limit(1).maybeSingle()
  if (error) throw error
  return data
}

/** Creates the target record once. Returns { created: boolean, id }. */
export async function convert(kind, source) {
  const existing = await findConverted(kind, source.id)
  if (existing) return { created: false, id: existing.id }
  const c = CONVERSIONS[kind]
  const { data, error } = await supabase.from(c.table).insert(buildConversion(kind, source)).select('id').single()
  if (error) {
    if (error.code === '23505') {
      const again = await findConverted(kind, source.id)
      return { created: false, id: again?.id }
    }
    throw error
  }
  return { created: true, id: data.id }
}
