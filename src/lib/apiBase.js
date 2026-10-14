// Where the AI endpoint lives. Pure functions so the choice can be unit-tested without a browser.
//  - Web: the relative path, exactly as before (same origin as the site).
//  - Android: inside the app the page origin is https://localhost, so a relative path cannot reach the backend.
//    The deployed backend address is NOT stored in this repository, so it must be supplied at build time as
//    VITE_API_BASE_URL (a public address, not a secret). If it is missing or invalid, AI is reported as unavailable.
export const AI_PATH = '/api/ai-chat'

/** Accepts an https address and returns ONLY its origin (no path, query, hash, trailing slash), or '' if invalid or it carries credentials.
 *  Dropping the path means a value pasted as "https://site/api/ai-chat" or "https://site/login" can never produce "…/api/ai-chat/api/ai-chat". */
export function normalizeApiBase(value) {
  if (typeof value !== 'string') return ''
  const v = value.trim().replace(/\/+$/, '')
  if (!v) return ''
  let u
  try {
    u = new URL(v)
  } catch {
    return ''
  }
  if (u.protocol !== 'https:' || u.username || u.password) return ''
  return u.origin
}

/** => { url, configured }. url is null when the native app has no usable backend address. */
export function resolveAiEndpoint({ native = false, apiBase = '' } = {}) {
  if (!native) return { url: AI_PATH, configured: true }
  const base = normalizeApiBase(apiBase)
  return base ? { url: `${base}${AI_PATH}`, configured: true } : { url: null, configured: false }
}
