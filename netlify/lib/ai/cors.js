// Restricted CORS for the AI endpoint (needed only by the Android app).
// Why: inside the Android app the page origin is https://localhost (Capacitor, androidScheme "https"). That is a different
// origin from the backend, so the WebView first sends a preflight OPTIONS request, then the real request.
// Rules:
//  - Exact origins only, never "*". Authentication is unchanged: the Bearer token is still verified by the function itself.
//  - Requests from the website itself send no cross-origin headers, are not touched, and are never rejected because of CORS.
//  - A request from any other origin gets no CORS headers, so the browser blocks it.
export const ALLOWED_ORIGINS = ['https://localhost']
export const ALLOWED_HEADERS = 'authorization, content-type'
export const ALLOWED_METHODS = 'GET, POST, OPTIONS'

function corsHeaders(request) {
  const origin = request.headers.get('origin')
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return null
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': ALLOWED_HEADERS,
    'access-control-allow-methods': ALLOWED_METHODS,
    'access-control-max-age': '600',
    vary: 'Origin',
  }
}

/** Answers a preflight. Returns null when the request is not an OPTIONS request. */
export function preflight(request) {
  if (request.method !== 'OPTIONS') return null
  const headers = corsHeaders(request)
  return new Response(null, { status: headers ? 204 : 403, headers: headers || { 'cache-control': 'no-store' } })
}

/** Adds CORS headers to a response only when the caller's origin is on the allow-list. */
export function withCors(request, response) {
  const headers = corsHeaders(request)
  if (!headers) return response
  const merged = new Headers(response.headers)
  for (const [k, v] of Object.entries(headers)) merged.set(k, v)
  return new Response(response.body, { status: response.status, headers: merged })
}
