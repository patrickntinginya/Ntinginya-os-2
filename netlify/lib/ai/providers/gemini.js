// Google Gemini through the REST API (generateContent). Runs only inside the Netlify function; the key is sent in the
// x-goog-api-key header, never in a URL, and never returned to the browser.
import { ProviderError, kindFromStatus } from '../errors.js'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
export const GEMINI_DEFAULT_MODEL = 'gemini-3.1-flash-lite'
export const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

const SCHEMA_KEYS = ['type', 'description', 'enum', 'items', 'format', 'nullable', 'minimum', 'maximum', 'minItems', 'maxItems']

/** Gemini accepts an OpenAPI subset of JSON Schema. Keep only the keys it understands; drop the rest. */
export function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema
  const out = {}
  for (const k of SCHEMA_KEYS) if (schema[k] !== undefined) out[k] = k === 'items' ? toGeminiSchema(schema.items) : schema[k]
  if (schema.properties && typeof schema.properties === 'object') {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([name, s]) => [name, toGeminiSchema(s)]))
    if (Array.isArray(schema.required) && schema.required.length) out.required = schema.required
  }
  return out
}

export const toGeminiTools = (tools = []) =>
  tools.length ? [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.input_schema) })) }] : undefined

/** Gemini calls the assistant role "model" and wants alternating turns, so same-role neighbours are merged. */
export function toGeminiContents(messages = []) {
  const out = []
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user'
    const text = String(m.content ?? '')
    if (!text) continue
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].parts[0].text += `\n\n${text}`
    else out.push({ role, parts: [{ text }] })
  }
  return out
}

export const gemini = {
  name: 'gemini',
  keyEnv: 'GEMINI_API_KEY',
  modelEnv: 'GEMINI_MODEL',
  needsKey: true,
  defaultModel: GEMINI_DEFAULT_MODEL,
  // Gemini 3 models may spend output tokens on internal thinking, so the default budget is larger.
  defaultMaxTokens: 2048,
  async call({ apiKey, model, maxTokens, system, messages, tools, signal }) {
    if (!MODEL_PATTERN.test(model || '')) throw new ProviderError('bad_model', 'model')
    const geminiTools = toGeminiTools(tools)
    let res
    try {
      res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: toGeminiContents(messages),
          generationConfig: { maxOutputTokens: maxTokens },
          ...(geminiTools ? { tools: geminiTools, toolConfig: { functionCallingConfig: { mode: 'AUTO' } } } : {}),
        }),
      })
    } catch (e) {
      throw new ProviderError(e.name === 'AbortError' ? 'timeout' : 'network')
    }
    if (!res.ok) {
      let status = ''
      try { status = (await res.json())?.error?.status || '' } catch { /* not JSON */ }
      throw new ProviderError(`provider_status_${res.status}`, status === 'RESOURCE_EXHAUSTED' ? 'rate_limit' : kindFromStatus(res.status))
    }
    const body = await res.json()
    const cand = body.candidates?.[0]
    const parts = Array.isArray(cand?.content?.parts) ? cand.content.parts : []
    return {
      text: parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim(),
      toolCalls: parts.filter((p) => p.functionCall?.name).map((p) => ({ name: p.functionCall.name, input: p.functionCall.args || {} })),
      stopReason: cand?.finishReason || body.promptFeedback?.blockReason || null,
    }
  },
}
