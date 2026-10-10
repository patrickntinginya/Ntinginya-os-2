// POST /.netlify/functions/ai-chat   (GET ?status=1 reports whether an AI key is configured)
// The AI key lives only in this function's environment. Every database read/write below uses a client that carries
// the caller's own access token, so Row Level Security keeps each user inside their own data.
import { createClient } from '@supabase/supabase-js'
import { callModel, ProviderError, publicStatus, resolveProvider } from '../lib/ai/provider.js'
import { FALLBACK_MESSAGES, providerErrorReply } from '../lib/ai/http.js'
import { dailyLimitReached, makeBurstLimiter } from '../lib/ai/limits.js'
import { MODES, MODE_INSTRUCTIONS, systemPrompt } from '../lib/ai/prompts.js'
import { buildContext } from '../lib/ai/context.js'
import { toolDefinitions, validateAction } from '../../src/lib/ai/actions.js'

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const GENERIC = 'Something went wrong. Please try again.'
const burst = makeBurstLimiter({ max: 8, windowMs: 60000 })
const failure = (code, status) => json(status, { error: code, message: FALLBACK_MESSAGES[code] || GENERIC })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default async (request) => {
  const env = process.env
  const url = new URL(request.url)

  if (request.method === 'GET') {
    return url.searchParams.get('status') ? json(200, publicStatus(resolveProvider(env))) : json(405, { error: 'method_not_allowed', message: GENERIC })
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
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: userData, error: userError } = await client.auth.getUser(token)
  if (userError || !userData?.user) return json(401, { error: 'unauthorized', message: 'Please sign in again.' })

  // 2. Is the AI configured, and has this user switched it on? (The app works fully without either.)
  const cfg = resolveProvider(env)
  if (!cfg.configured) return json(503, { error: 'ai_not_configured', message: 'AI Assistant is not configured yet.' })
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
  const lang = body.lang === 'sw' ? 'sw' : 'en'

  // Connection test used by Settings -> AI ("Test connection"). Tiny call, no data is read or stored.
  if (body.mode === 'ping') {
    if (!burst.allow(userData.user.id)) return failure('burst_limit', 429)
    try {
      await callModel(cfg, { system: 'Reply with the single word: ok', messages: [{ role: 'user', content: 'ping' }], maxTokens: 64, timeoutMs: 15000 })
      return json(200, { ok: true })
    } catch (e) {
      const r = providerErrorReply(e)
      console.error('ai-chat ping failed:', e?.kind || 'unknown')
      return failure(r.error, r.status)
    }
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const mode = body.mode || 'chat'
  const today = typeof body.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : null
  const conversationId = body.conversation_id && UUID.test(body.conversation_id) ? body.conversation_id : null
  const entityId = body.entity_id && UUID.test(body.entity_id) ? body.entity_id : null
  if (!message || message.length > 4000 || !MODES.includes(mode) || !today || Number.isNaN(new Date(`${today}T00:00:00Z`).getTime())) {
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
    const result = await callModel(cfg, {
      system: systemPrompt(today, weekday, lang),
      messages: [...history.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: userTurn }],
      tools: toolDefinitions(),
    })

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

    return json(200, { conversation_id: convId, reply, actions })
  } catch (e) {
    // Log the kind of failure only. Never log user data, tokens, keys or provider response text.
    if (e instanceof ProviderError) {
      const r = providerErrorReply(e)
      console.error('ai-chat provider failure:', e.kind)
      return failure(r.error, r.status)
    }
    console.error('ai-chat failed:', e?.code || e?.name || 'unknown')
    return json(500, { error: 'server_error', message: GENERIC })
  }
}
