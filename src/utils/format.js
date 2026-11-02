import { tr } from '../i18n/index.js'

/** Default account currency. Every money value is stored as a plain number; only the display adds "TSh". */
export const DEFAULT_CURRENCY = 'TZS'

const group = (n) => Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })

/**
 * TZS -> "TSh 1,500,000" (whole shillings, comma grouping).
 * Other ISO codes use Intl so the app is ready for more currencies later.
 */
export function formatMoney(amount, currency = DEFAULT_CURRENCY) {
  const n = Number(amount)
  const value = Number.isFinite(n) ? n : 0
  if (currency === 'TZS') {
    const rounded = Math.round(value)
    return `${rounded < 0 ? '-' : ''}TSh ${group(rounded)}`
  }
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

/** Short form for chart axes: 1.5M, 250K. */
export function formatCompact(amount) {
  const n = Number(amount) || 0
  const a = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (a >= 1e9) return `${sign}${+(a / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${sign}${+(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${sign}${+(a / 1e3).toFixed(0)}K`
  return `${sign}${Math.round(a)}`
}

export const sum = (rows, key = 'amount') => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0)
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n))
export const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

const GENERIC = 'Something went wrong. Please try again.'

/** Never show raw database or API text to the user. Known cases get a specific, friendly message. */
export function friendlyError(error, fallback = tr(GENERIC)) {
  if (!error) return fallback
  const msg = String(error.message || error)
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return tr('Could not reach the server. Check your connection and try again.')
  if (/relation .* does not exist|Could not find the (table|function)|schema cache/i.test(msg)) {
    return tr('The database is not up to date. Run the latest migrations from supabase/migrations.')
  }
  if (/row-level security|permission denied/i.test(msg)) return tr('You do not have permission to do that.')
  if (/duplicate key|already exists/i.test(msg)) return tr('That already exists.')
  if (/Linked record not found/i.test(msg)) return tr('The linked item could not be found.')
  if (/violates check constraint|invalid input syntax|violates not-null/i.test(msg)) return tr('Some of the information is not valid. Check the form and try again.')
  if (/JWT|session|not authenticated/i.test(msg)) return tr('Your session has expired. Please sign in again.')
  return fallback
}

export function friendlyAuthError(error) {
  const msg = error?.message || ''
  if (/invalid login credentials/i.test(msg)) return tr('Incorrect email or password.')
  if (/email not confirmed/i.test(msg)) return tr('Confirm your email first. Check your inbox for the link.')
  if (/already registered|already been registered/i.test(msg)) return tr('An account with this email already exists. Try signing in.')
  if (/password should be at least/i.test(msg)) return tr('Password must be at least 6 characters.')
  if (/rate limit|too many/i.test(msg)) return tr('Too many attempts. Wait a minute and try again.')
  return friendlyError(error)
}
