// CORS / origin policy for /api/ai-chat. Exact origins only, never "*" (requests carry a Bearer token).
//  - Same-origin requests (the website calling its own /api/ai-chat) need no CORS headers and are always allowed.
//    Browsers still send an Origin header on same-origin POSTs, so it is compared with the request's own host.
//  - The Android app (Capacitor, androidScheme "https") runs on the origin https://localhost, which is allowed.
//  - Extra origins, such as a custom domain, go in AI_ALLOWED_ORIGINS (comma separated). Vercel's own production and
//    deployment hostnames (VERCEL_PROJECT_PRODUCTION_URL, VERCEL_URL) are added automatically when present.
//  - Any other origin is refused with 403 and receives no CORS headers.
export const ANDROID_ORIGIN = 'https://localhost'
export const ALLOWED_ORIGINS = [ANDROID_ORIGIN]
export const ALLOWED_HEADERS = 'authorization, content-type'
export const ALLOWED_METHODS = 'GET, POST, OPTIONS'

/** Turns "https://a.example/" or "a.example" into "https://a.example". Returns '' when it is not a plain https origin. */
export function toOrigin(value) {
  const v = String(value || '').trim()
  if (!v) return ''
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`)
    return u.protocol === 'https:' ? u.origin : ''
  } catch {
    return ''
  }
}

export function allowedOrigins(env = {}) {
  const extra = String(env.AI_ALLOWED_ORIGINS || '').split(',').map(toOrigin)
  const vercel = [env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_URL].map(toOrigin)
  return new Set([...ALLOWED_ORIGINS, ...extra, ...vercel].filter(Boolean))
}

/** => { origin, sameOrigin, allowed, blocked }. `allowed` means "send CORS headers back". */
export function corsDecision(request, env = {}) {
  const origin = request.headers.get('origin')
  if (!origin) return { origin: null, sameOrigin: true, allowed: false, blocked: false }
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || new URL(request.url).host
  const sameOrigin = origin === `https://${host}` || origin === `http://${host}`
  const allowed = !sameOrigin && allowedOrigins(env).has(origin)
  return { origin, sameOrigin, allowed, blocked: !sameOrigin && !allowed }
}

const corsHeaders = (decision) => ({
  'access-control-allow-origin': decision.origin,
  'access-control-allow-headers': ALLOWED_HEADERS,
  'access-control-allow-methods': ALLOWED_METHODS,
  'access-control-max-age': '600',
  vary: 'Origin',
})

/** Answers a preflight. Returns null when the request is not an OPTIONS request. */
export function preflight(request, decision) {
  if (request.method !== 'OPTIONS') return null
  if (decision.blocked) return new Response(null, { status: 403, headers: { 'cache-control': 'no-store', vary: 'Origin' } })
  return new Response(null, { status: 204, headers: decision.allowed ? corsHeaders(decision) : { vary: 'Origin' } })
}

/** Adds CORS headers to a response only when the caller's origin is on the allow-list. */
export function withCors(response, decision) {
  const merged = new Headers(response.headers)
  merged.append('vary', 'Origin')
  if (decision.allowed) for (const [k, v] of Object.entries(corsHeaders(decision))) if (k !== 'vary') merged.set(k, v)
  return new Response(response.body, { status: response.status, headers: merged })
}
