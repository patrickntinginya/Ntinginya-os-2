import { tr } from '../i18n/index.js'

// Locale used for month/day names. The language provider sets it (sw-TZ or en-GB); undefined = the browser's own.
let locale
export const setDateLocale = (l) => { locale = l }

const pad = (n) => String(n).padStart(2, '0')

/** Local calendar date as YYYY-MM-DD (avoids the UTC off-by-one of toISOString). */
export const toISODate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const todayISO = () => toISODate()

export const parseISO = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const addDays = (iso, n) => {
  const d = parseISO(iso)
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

/** Add whole months, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(iso, n) {
  const d = parseISO(iso)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return toISODate(d)
}

export const startOfMonth = (iso) => `${iso.slice(0, 7)}-01`
export const startOfNextMonth = (iso) => addMonths(startOfMonth(iso), 1)
export const startOfPrevMonth = (iso) => addMonths(startOfMonth(iso), -1)

/** Monday of the week containing iso. */
export function startOfWeek(iso) {
  const d = parseISO(iso)
  const diff = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - diff)
  return toISODate(d)
}

export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000)
export const dateOfTimestamp = (ts) => toISODate(new Date(ts))

export function formatDate(iso) {
  if (!iso) return ''
  const d = parseISO(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(locale, {
    weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }),
  })
}

export function formatMonth(iso) {
  return parseISO(iso).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
}
export function formatMonthShort(iso) {
  return parseISO(iso).toLocaleDateString(locale, { month: 'short' })
}

export function formatTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
}

export function formatLongDate(d = new Date()) {
  return d.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

export function greeting(d = new Date()) {
  const h = d.getHours()
  if (h < 12) return tr('Good morning')
  if (h < 18) return tr('Good afternoon')
  return tr('Good evening')
}

export const timeToMinutes = (t) => {
  const [h, m] = String(t).split(':').map(Number)
  return h * 60 + m
}

/** One step forward for a repeat rule. 'custom' needs intervalDays. */
export function addInterval(iso, repeat, intervalDays = 1) {
  if (repeat === 'daily') return addDays(iso, 1)
  if (repeat === 'weekly') return addDays(iso, 7)
  if (repeat === 'monthly') return addMonths(iso, 1)
  if (repeat === 'custom') return addDays(iso, Math.max(1, Number(intervalDays) || 1))
  return iso
}

/** Next occurrence of a repeating reminder that is `today` or later. */
export function nextOccurrence(iso, repeat, intervalDays, today = todayISO()) {
  if (!repeat || repeat === 'none') return iso
  let next = addInterval(iso, repeat, intervalDays)
  let guard = 0
  while (next < today && guard++ < 1000) next = addInterval(next, repeat, intervalDays)
  return next
}
