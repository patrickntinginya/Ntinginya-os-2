// Core of POST /api/ai-chat (GET ?status=1 reports whether an AI key is configured). Web-standard Request -> Response,
// so it runs on Vercel (see ../../ai-chat.js) and can be unit-tested without a server.
// The AI key lives only in the server environment. Every database read/write below uses a client that carries
// the caller's own access token, so Row Level Security keeps each user inside their own data.
import { ProviderError, publicStatus, resolveProvider } from './provider.js'
import { availability, configuredProviders, normalizeSelection, pickCandidates, routeModel, routerLimits } from './router.js'
import { sharedHealth } from './health.js'
import { FALLBACK_MESSAGES, providerErrorReply } from './http.js'
import { dailyLimitReached, makeBurstLimiter } from './limits.js'
import { MODES, MODE_INSTRUCTIONS, systemPrompt } from './prompts.js'
import { buildContext } from './context.js'
import { toolDefinitions, validateAction } from '../../../src/lib/ai/actions.js'
import { corsDecision, preflight, withCors } from './cors.js'

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const GENERIC = 'Something went wrong. Please try again.'
const burst = makeBurstLimiter({ max: 8, windowMs: 60000 })
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
  const { data: prof } = await client.from('profiles').select('ai_enabled').eq('user_id', userData.user.id).maybeSingle()
  if (prof && prof.ai_enabled === false) return json(403, { error: 'ai_disabled', message: 'AI is turned off in your settings.' })

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

  // Connection test used by Settings -> AI ("Test connection"). Tiny call, no data is read or stored.
  if (body.mode === 'ping') {
    if (!burst.allow(userData.user.id)) return failure('burst_limit', 429)
    try {
      // One quick attempt per provider, no retries: a connection test should report the truth fast.
      await deps.route(env, { system: 'Reply with the single word: ok', messages: [{ role: 'user', content: 'ping' }], maxTokens: 64 }, { selection, signal: request.signal, health: deps.health, limits: { totalMs: 12000, attemptMs: 8000, maxRetries: 0 }, logger: deps.logger })
      return json(200, { ok: true })
    } catch (e) {
      const r = providerErrorReply(e)
      console.error('ai-chat ping failed:', e?.kind || 'unknown', e?.correlationId || '')
      return failure(r.error, r.status, e?.correlationId)
    }
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const mode = body.mode || 'chat'
  const today = typeof body.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : null
  const conversationId = body.conversation_id && UUID.test(body.conversation_id) ? body.conversation_id : null
  const entityId = body.entity_id && UUID.test(body.entity_id) ? body.entity_id : null
  if (!message || message.length > 4000 || typeof mode !== 'string' || !MODES.includes(mode) || !today || Number.isNaN(new Date(`${today}T00:00:00Z`).getTime())) {
    return json(400, { error: 'bad_request', message: 'Please check your message and try again.' })
  }

  if (!burst.allow(userData.user.id)) return failure('burst_limit', 429)

  try {
    // 4. Daily cost guard (counts this user's messages in the last 24 hours).
    const limit = cfg.dailyLimit
    const since = new Date(Date.now() - 86400000).toISOString()
    const { count } = await client.from('ai_messages').select('id', { count: 'exact', head: true }).eq('role', 'user').gte('created_at', since)
    if (dailyLimitReached(count, limit)) return json(429, { error: 'rate_limited', message: FALLBACK_MESSAGES.daily_limit })

    // 5. Conversation (must belong to the caller; RLS enforces this).
    let convId = conversationId
    let history = []
    if (convId) {
      const { data: conv } = await client.from('ai_conversations').select('id').eq('id', convId).maybeSingle()
      if (!conv) return json(404, { error: 'not_found', message: 'That conversation was not found.' })
      const { data: msgs } = await client.from('ai_messages').select('role,content').eq('conversation_id', convId).order('created_at', { ascending: false }).limit(10)
      history = (msgs || []).reverse()
    } else {
      const { data: conv, error } = await client.from('ai_conversations').insert({ title: message.slice(0, 60) }).select('id').single()
      if (error) throw error
      convId = conv.id
    }

    // 6. Real data + model call.
    const { block } = await buildContext(client, { today, mode, entityId })
    const weekday = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()]
    const instruction = MODE_INSTRUCTIONS[mode]
    const userTurn = `${block}\n\n${instruction ? `Task: ${instruction}\n\n` : ''}User message: ${message}`
    // Bounded retry -> automatic failover -> health tracking happen inside routeModel. Nothing is written to the database
    // until it returns ONE complete, validated answer, so a retry or a provider switch can never duplicate a message.
    const routed = await deps.route(env, {
      system: systemPrompt(today, weekday, lang),
      messages: [...history.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: userTurn }],
      tools: toolDefinitions(),
    }, { selection, signal: request.signal, health: deps.health, logger: deps.logger })
    const result = routed.result

    // 7. Validate proposed actions; store them as PENDING. Nothing is executed here.
    const proposals = []
    for (const call of result.toolCalls.slice(0, 6)) {
      const checked = validateAction(call.name, call.input)
      if (checked.ok) proposals.push({ action_type: call.name, payload: checked.values, summary: checked.summary })
    }
    const reply = result.text || (proposals.length ? `I prepared ${proposals.length} action${proposals.length === 1 ? '' : 's'} for you to review below.` : 'I could not produce an answer. Please try rephrasing.')

    const { error: msgError } = await client.from('ai_messages').insert([
      { conversation_id: convId, role: 'user', content: message },
      { conversation_id: convId, role: 'assistant', content: reply },
    ])
    if (msgError) throw msgError

    let actions = []
    if (proposals.length) {
      const { data, error } = await client.from('ai_action_requests').insert(proposals.map((p) => ({ ...p, conversation_id: convId }))).select()
      if (error) throw error
      actions = data
    }
    await client.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId)

    return json(200, { conversation_id: convId, reply, actions, provider: routed.provider, fallback_used: routed.fallbackUsed, request_id: routed.correlationId })
  } catch (e) {
    // Log the kind of failure only. Never log user data, tokens, keys or provider response text.
    if (e instanceof ProviderError) {
      const r = providerErrorReply(e)
      console.error('ai-chat provider failure:', e.kind, e.correlationId || '')
      return failure(r.error, r.status, e.correlationId)
    }
    console.error('ai-chat failed:', e?.code || e?.name || 'unknown')
    return json(500, { error: 'server_error', message: GENERIC })
  }
}

// Entry point. Origin policy first (see ./cors.js), then the handler above, which verifies the caller's Bearer token
// on every request.
export async function handleAiRequest(request, env = process.env, overrides = {}) {
  const deps = { authenticate: defaultAuthenticate, route: routeModel, health: sharedHealth, logger: undefined, ...overrides }
  const decision = corsDecision(request, env)
  const early = preflight(request, decision)
  if (early) return early
  if (decision.blocked) return json(403, { error: 'origin_not_allowed', message: GENERIC })
  let response
  try {
    response = await handle(request, env, deps)
  } catch (e) {
    console.error('ai-chat unhandled:', e?.code || e?.name || 'unknown')
    response = json(500, { error: 'server_error', message: GENERIC })
  }
  return withCors(response, decision)
}
