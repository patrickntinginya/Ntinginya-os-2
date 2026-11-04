// OpenRouter through its official OpenAI-compatible API. Server-side only; the key never reaches the browser.
// The upstream URL is fixed here: neither the browser nor any request field can choose it.
import { ProviderError, kindFromStatus } from '../errors.js'
import { toOpenAiTools } from './openai.js'

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'
// There is deliberately NO default model: free model IDs change and could not be verified offline.
// The administrator must set OPENROUTER_MODEL (copy a current ID from https://openrouter.ai/models). Without it the
// provider is reported as not configured instead of guessing.
export const OPENROUTER_MODEL_PATTERN = /^(?=.{1,96}$)[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*(:[A-Za-z0-9._-]+)?$/

export const openrouter = {
  name: 'openrouter',
  keyEnv: 'OPENROUTER_API_KEY',
  modelEnv: 'OPENROUTER_MODEL',
  needsKey: true,
  defaultModel: '',
  defaultMaxTokens: 2048,
  async call({ apiKey, model, maxTokens, system, messages, tools, signal }) {
    if (!OPENROUTER_MODEL_PATTERN.test(model || '')) throw new ProviderError('bad_model', 'model')
    let res
    try {
      res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, 'x-title': 'Ntinginya Life OS' },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [{ role: 'system', content: system }, ...messages],
          ...(tools?.length ? { tools: toOpenAiTools(tools) } : {}),
        }),
      })
    } catch (e) {
      throw new ProviderError(e?.name === 'AbortError' ? 'timeout' : 'network')
    }
    if (!res.ok) {
      const err = new ProviderError(`provider_status_${res.status}`, kindFromStatus(res.status))
      const ra = Number(res.headers?.get?.('retry-after'))
      if (Number.isFinite(ra) && ra >= 0) err.retryAfterMs = Math.min(ra * 1000, 60000)
      throw err
    }
    let body
    try { body = await res.json() } catch {
      const error = new ProviderError('malformed_response', 'malformed')
      error.httpStatus = res.status
      throw error
    }
    // OpenRouter can answer 200 with an error object in the body.
    if (body?.error) {
      const error = new ProviderError('provider_body_error', body.error.code === 429 ? 'rate_limit' : 'server')
      error.httpStatus = res.status
      throw error
    }
    const choice = body?.choices?.[0]
    if (!choice || !choice.message || typeof choice.message !== 'object') {
      const error = new ProviderError('malformed_response', 'malformed')
      error.httpStatus = res.status
      throw error
    }
    const msg = choice.message
    const toolCalls = []
    for (const c of msg.tool_calls || []) {
      try { toolCalls.push({ name: c.function.name, input: JSON.parse(c.function.arguments || '{}') }) } catch { /* malformed tool call dropped */ }
    }
    const text = (typeof msg.content === 'string' ? msg.content : '').trim()
    if (!text && !toolCalls.length) {
      const error = new ProviderError('empty_response', 'malformed')
      error.httpStatus = res.status
      throw error
    }
    return { text, toolCalls, stopReason: choice.finish_reason || null }
  },
}
