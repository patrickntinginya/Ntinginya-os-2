// Core of POST /api/ai-chat (GET ?status=1 reports whether an AI key is configured). Web-standard Request -> Response,
// so it runs on Vercel (see ../../ai-chat.js) and can be unit-tested without a server.
// The AI key lives only in the server environment. Every database read/write below uses a client that carries
// the caller's own access token, so Row Level Security keeps each user inside their own data.
import { ProviderError, publicStatus, resolveProvider } from './provider.js'
import { availability, configuredProviders, normalizeSelection, pickCandidates, routeModel, routerLimits } from './router.js'
import { sharedHealth } from './health.js'
import { FALLBACK_MESSAGES, providerErrorReply } from './http.js'
import { consumeAiRequest } from './usage.js'
import { MODES, MODE_INSTRUCTIONS, systemPrompt } from './prompts.js'
import { buildContext } from './context.js'
import { toolDefinitions, validateAction } from '../../../src/lib/ai/actions.js'
import { normalizeAiContextCategories } from '../../../src/lib/ai/contextCategories.js'
import { corsDecision, preflight, withCors } from './cors.js'

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const GENERIC = 'Something went wrong. Please try again.'
const failure = (code, status, requestId) => json(status, { error: code, message: FALLBACK_MESSAGES[code] || GENERIC, ...(requestId ? { request_id: requestId } : {}) })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Browser-safe status: which providers the server can use (names + coarse health only; never keys, URLs or models of others). */
function statusBody(env) {
  const primary = resolveProvider(env)
  const providers = availability(env)
  const first = pickCandidates(env, 'auto')[0]
  const base = publicStatus(first || primary)
  return { ...base, configured: Boolean(first), providers }
}

/** Verifies the bearer token with Supabase. Injectable so tests need no network. Returns { client, user } or null. */
async function defaultAuthenticate(token, env) {
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY
  const { createClient } = await import('@supabase/supabase-js') // loaded only when a real authenticated call arrives
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await client.auth.getUser(token)
  return error || !data?.user ? null : { client, user: data.user }
}

// Administrators are recognised ONLY from app_metadata of the Supabase-verified user: that field can be written by the
// service role / dashboard, never by the user (unlike user_metadata). Same rule as safe_mode_is_admin() in SQL.
const isAdminUser = (user) => ['admin', 'owner'].includes(String(user?.app_metadata?.role || ''))

/** GET ?diagnostics=1 : administrators only. Counters, timings and failure categories; no keys, prompts or answers. */
async function diagnostics(request, env, deps) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return json(401, { error: 'unauthorized', message: 'Please sign in again.' })
  const auth = await deps.authenticate(token, env)
  if (!auth) return json(401, { error: 'unauthorized', message: 'Please sign in again.' })
  if (!isAdminUser(auth.user)) return failure('forbidden', 403)
  const { list } = configuredProviders(env)
  const names = ['gemini', 'openrouter']
  const snap = deps.health.snapshot(names)
  const limits = routerLimits(env)
  return json(200, {
    ...snap,
    configured: names.map((n) => ({ name: n, configured: list.some((c) => c.name === n), model: list.find((c) => c.name === n)?.model || null })),
    limits: { totalMs: limits.totalMs, attemptMs: limits.attemptMs, maxRetries: limits.maxRetries },
  })
}

async function handle(request, env, deps) {
  const url = new URL(request.url)

  if (request.method === 'GET') {
    if (url.searchParams.get('status')) return json(200, statusBody(env))
    if (url.searchParams.get('diagnostics')) return diagnostics(request, env, deps)
    return json(405, { error: 'method_not_allowed', message: GENERIC })
  }
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed', message: GENERIC })

  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    console.error('ai-chat: Supabase environment variables are missing')
    return json(500, { error: 'server_misconfigured', message: GENERIC })
  }

  // 1. Who is calling? Verified by Supabase, never trusted from the request body.
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return json(401, { error: 'unauthorized', message: 'Please sign in again.' })
  const auth = await deps.authenticate(token, env)
  if (!auth) return json(401, { error: 'unauthorized', message: 'Please sign in again.' })
  const { client, user } = auth
  const userData = { user }

  // 2. Is any AI provider configured, and has this user switched AI on? (The app works fully without either.)
  const cfg = resolveProvider(env)
  if (!pickCandidates(env, 'auto').length) return json(503, { error: 'ai_not_configured', message: 'AI Assistant is not configured yet.' })
  const { data: prof, error: profileError } = await client.from('profiles').select('ai_enabled').eq('user_id', userData.user.id).maybeSingle()
  if (profileError || !prof) return json(503, { error: 'ai_settings_unavailable', message: 'AI settings could not be verified. Please try again later.' })
  if (typeof prof.ai_enabled !== 'boolean') return json(503, { error: 'ai_settings_unavailable', message: 'AI settings could not be verified. Please try again later.' })
  if (!prof.ai_enabled) return json(403, { error: 'ai_disabled', message: 'AI is turned off in your settings.' })

  // 3. Validate input.
  let body
  try {
    const raw = await request.text()
    if (raw.length > 20000) return json(413, { error: 'too_large', message: 'That message is too long.' })
    body = JSON.parse(raw)
  } catch {
    return json(400, { error: 'bad_request', message: GENERIC })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'bad_request', message: GENERIC })
  const lang = body.lang === 'sw' ? 'sw' : 'en'
  // The user's provider choice. Anything unknown means automatic; it can never name an upstream address or a model.
  const selection = normalizeSelection(body.provider)

  // Both connection pings and chat requests consume the same fixed database quota. The RPC owns
  // the 100-per-rolling-day and 8-per-minute limits; request mode cannot weaken either limit.
  const usage = await consumeAiRequest(client)
  if (!usage.available) return json(503, { error: 'usage_limit_unavailable', message: 'AI usage limits could not be checked. Please try again later.' })
  if (!usage.allowed) return failure(usage.reason || 'burst_limit', 429)

  // Connection test used by Settings -> AI (