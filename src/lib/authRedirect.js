// Email-link (sign-up confirmation and password reset) handling for the Android app. Pure and unit-tested.
//
// Web: unchanged. The links return to `${origin}/login` and `${origin}/reset-password`.
// Android: the page origin is https://localhost, which an email cannot open. Links instead return to the app through a
// custom URL scheme:  com.ntinginya.personallifeos://login   and   com.ntinginya.personallifeos://reset-password
// Supabase appends the session tokens after '#'. They are read once, handed straight to supabase-js, and never stored in
// router state, logged, or shown.
//
// SAFETY: any app on the phone can fire a custom-scheme link. To stop a hostile app from signing the user into an
// attacker's account, a callback is accepted ONLY if this app asked for one recently (markAuthPending) and it matches that kind.
import { isNativePlatform } from './platform.js'

export const NATIVE_AUTH_SCHEME = 'com.ntinginya.personallifeos'
export const NATIVE_AUTH_PATHS = ['login', 'reset-password']
export const PENDING_KEY = 'life-os-auth-pending'
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000
const MAX_TOKEN_LENGTH = 4096
const TOKEN_RE = /^[A-Za-z0-9._~+/=-]+$/

/** The redirect address to give Supabase. `path` is 'login' or 'reset-password'. */
export function authRedirectUrl(path, { native = isNativePlatform(), origin = globalThis.window?.location?.origin } = {}) {
  if (!NATIVE_AUTH_PATHS.includes(path)) throw new Error('Unknown auth redirect path')
  return native ? `${NATIVE_AUTH_SCHEME}://${path}` : `${origin}/${path}`
}

const KIND_BY_TYPE = { recovery: 'recovery', signup: 'signup' }

/**
 * Parses a deep link. Never throws and never returns tokens for a link that is not ours.
 * => { ok:false, reason } | { ok:true, path, kind, accessToken, refreshToken, error }
 */
export function parseAuthCallback(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 8192) return { ok: false, reason: 'not_auth_url' }
  const m = /^([a-z][a-z0-9+.-]*):\/\/([a-z0-9-]+)\/?(?:\?([^#]*))?(?:#(.*))?$/i.exec(rawUrl.trim())
  if (!m || m[1].toLowerCase() !== NATIVE_AUTH_SCHEME) return { ok: false, reason: 'not_auth_url' }
  const path = m[2].toLowerCase()
  if (!NATIVE_AUTH_PATHS.includes(path)) return { ok: false, reason: 'not_auth_url' }

  const params = new URLSearchParams(m[3] || '')
  for (const [k, v] of new URLSearchParams(m[4] || '')) params.set(k, v) // the fragment wins over the query

  const type = params.get('type')
  const kind = KIND_BY_TYPE[type] || (path === 'reset-password' ? 'recovery' : 'signup')
  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  const errCode = params.get('error_code') || params.get('error')
  const hasTokens = Boolean(accessToken && refreshToken)
  if (hasTokens && !(TOKEN_RE.test(accessToken) && TOKEN_RE.test(refreshToken) && accessToken.length <= MAX_TOKEN_LENGTH && refreshToken.length <= MAX_TOKEN_LENGTH)) {
    return { ok: false, reason: 'malformed_tokens' }
  }
  // Only the error CODE is kept. The description is free text and is not needed.
  const error = errCode ? { code: String(errCode).slice(0, 64) } : null
  return { ok: true, path, kind, type, accessToken: hasTokens ? accessToken : null, refreshToken: hasTokens ? refreshToken : null, error }
}

/** Where the app should go after a callback. Never includes tokens. */
export function routeAfterCallback(parsed) {
  if (parsed.error) return parsed.path === 'reset-password' ? '/reset-password' : '/login'
  if (parsed.accessToken) return parsed.kind === 'recovery' ? '/reset-password' : '/dashboard'
  return parsed.path === 'reset-password' ? '/reset-password' : '/login'
}

// --- "this app asked for an email link" memory -------------------------------------------------------------------
const safeStorage = () => {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

export function markAuthPending(kind, { storage = safeStorage(), now = Date.now() } = {}) {
  if (!KIND_BY_TYPE[kind] && kind !== 'recovery' && kind !== 'signup') return false
  try {
    const current = JSON.parse(storage?.getItem(PENDING_KEY) || '{}')
    storage?.setItem(PENDING_KEY, JSON.stringify({ ...current, [kind]: now }))
    return true
  } catch {
    return false
  }
}

/** True once if this app requested a link of that kind within the last 24 h. Consumes the request for recovery; sign-up stays valid until it expires (a user may tap the link more than once). */
export function consumeAuthPending(kind, { storage = safeStorage(), now = Date.now() } = {}) {
  try {
    const current = JSON.parse(storage?.getItem(PENDING_KEY) || '{}')
    const at = current[kind]
    if (typeof at !== 'number' || now - at > PENDING_TTL_MS || at > now + 60000) return false
    if (kind === 'recovery') {
      delete current[kind]
      storage?.setItem(PENDING_KEY, JSON.stringify(current))
    }
    return true
  } catch {
    return false
  }
}
