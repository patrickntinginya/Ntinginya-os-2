// Smart Reflection Log helpers (pure). Storage: src/services/reflections.js -> table `reflections` (RLS: owner only).
export const MOODS = [1, 2, 3, 4, 5]
export const LIMITS = { text: 4000, action: 500, note: 8000 }
const FIELDS = ['went_well', 'difficult', 'tomorrow_action', 'note']

const clean = (v) => String(v ?? '').trim()
const scale = (v) => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : NaN
}

/** Returns { ok: true, values } or { ok: false, error: <i18n key> }. At least one field (mood, energy or text) is required. */
export function validateReflection(input = {}, today) {
  const date = input.entry_date || today
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return { ok: false, error: 'refl.err.date' }
  if (date > today) return { ok: false, error: 'refl.err.future' }
  const mood = scale(input.mood)
  const energy = scale(input.energy)
  if (Number.isNaN(mood) || Number.isNaN(energy)) return { ok: false, error: 'refl.err.scale' }
  const values = { entry_date: date, kind: input.kind === 'calm' ? 'calm' : 'daily', mood, energy }
  for (const f of FIELDS) values[f] = clean(input[f]) || null
  if (values.went_well && values.went_well.length > LIMITS.text) return { ok: false, error: 'refl.err.long' }
  if (values.difficult && values.difficult.length > LIMITS.text) return { ok: false, error: 'refl.err.long' }
  if (values.tomorrow_action && values.tomorrow_action.length > LIMITS.action) return { ok: false, error: 'refl.err.long' }
  if (values.note && values.note.length > LIMITS.note) return { ok: false, error: 'refl.err.long' }
  if (mood === null && energy === null && !FIELDS.some((f) => values[f])) return { ok: false, error: 'refl.err.empty' }
  return { ok: true, values }
}

/** Groups entries by local date, newest day first; inside a day newest entry first. */
export function groupByDate(entries = []) {
  const map = new Map()
  for (const e of entries) {
    const d = String(e.entry_date).slice(0, 10)
    if (!map.has(d)) map.set(d, [])
    map.get(d).push(e)
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, items]) => ({ date, items: items.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))) }))
}

/** Client-side guard before showing edit/delete. The database (RLS) is the real enforcement. */
export const canModify = (entry, userId) => Boolean(entry && userId && entry.user_id === userId)

/** Case-insensitive text filter across the written fields. */
export function filterEntries(entries, term) {
  const q = clean(term).toLowerCase()
  if (!q) return entries
  return entries.filter((e) => FIELDS.some((f) => String(e[f] ?? '').toLowerCase().includes(q)))
}

/** Consecutive-day writing run ending today or yesterday (for gentle encouragement; never shown as a failure). */
export function writingStreak(entries, today, addDaysFn) {
  const days = new Set(entries.filter((e) => e.kind !== 'calm').map((e) => String(e.entry_date).slice(0, 10)))
  let d = days.has(today) ? today : addDaysFn(today, -1)
  let n = 0
  while (days.has(d)) { n++; d = addDaysFn(d, -1) }
  return n
}
