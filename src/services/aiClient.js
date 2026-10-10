import { supabase } from '../lib/supabase'
import { db } from './db'
import { todayISO } from '../utils/date'
import { getLang, tr } from '../i18n/index.js'
import { aiErrorMessage } from './aiErrors'

const ENDPOINT = '/api/ai-chat'

/** Every AI failure the user should read as-is (the message is already translated and safe to show). */
export class AiError extends Error {}
export class AiNotConfiguredError extends AiError {}
export class AiUnavailableError extends AiError {}

/** Asks the server whether an AI key is set. The key itself never reaches the browser. */
export async function getAiStatus() {
  try {
    const res = await fetch(`${ENDPOINT}?status=1`)
    if (!res.ok) return { reachable: false, configured: false }
    const body = await res.json()
    return {
      reachable: true, configured: Boolean(body.configured), provider: body.provider || null, status: body.status || null,
      model: body.model || null, dailyLimit: body.dailyLimit ?? null, missing: body.missing || null,
    }
  } catch {
    return { reachable: false, configured: false }
  }
}

/** mode: chat | daily_review | weekly_review | idea_validation | finance_advice | goal_coach | learning_plan */
export async function sendToAssistant({ conversationId, message, mode = 'chat', entityId }) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new AiError(aiErrorMessage('unauthorized'))

  let res
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ conversation_id: conversationId || null, message, mode, entity_id: entityId || null, today: todayISO(), lang: getLang() }),
    })
  } catch {
    throw new AiUnavailableError(tr('Could not reach the server. Check your connection and try again.'))
  }

  if (res.status === 404) {
    throw new AiUnavailableError(tr('The AI service is not available here. When running locally, start the app with "npx netlify dev" instead of "npm run dev".'))
  }
  let body = null
  try {
    body = await res.json()
  } catch {
    /* non-JSON error page */
  }
  if (res.status === 403 && body?.error === 'ai_disabled') throw new AiNotConfiguredError(aiErrorMessage('ai_disabled'))
  if (res.status === 503 && body?.error === 'ai_not_configured') throw new AiNotConfiguredError(aiErrorMessage('ai_not_configured'))
  if (!res.ok) throw new AiError(aiErrorMessage(body?.error))
  return body
}

export const listConversations = () => db.list('ai_conversations', { order: [{ column: 'updated_at', ascending: false }], limit: 100 })
export const listMessages = (conversationId) =>
  db.list('ai_messages', { filters: [{ op: 'eq', column: 'conversation_id', value: conversationId }], order: [{ column: 'created_at', ascending: true }], limit: 500 })
export const listActionRequests = (conversationId) =>
  db.list('ai_action_requests', { filters: [{ op: 'eq', column: 'conversation_id', value: conversationId }], order: [{ column: 'created_at', ascending: true }], limit: 200 })
export const renameConversation = (id, title) => db.update('ai_conversations', id, { title: title.trim().slice(0, 120) || 'New conversation' })
export const deleteConversation = (id) => db.remove('ai_conversations', id)

/** Settings -> AI -> "Test connection": one tiny model call, no user data. Resolves to { ok: true } or { ok: false, message }. */
export async function testAiConnection() {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return { ok: false, message: aiErrorMessage('unauthorized') }
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mode: 'ping', lang: getLang() }),
    })
    if (res.ok) return { ok: true }
    let body = null
    try { body = await res.json() } catch { /* not JSON */ }
    return { ok: false, message: aiErrorMessage(body?.error) }
  } catch {
    return { ok: false, message: tr('Could not reach the server. Check your connection and try again.') }
  }
}
