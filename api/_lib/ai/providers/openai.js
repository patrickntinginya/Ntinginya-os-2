import { ProviderError } from '../errors.js'

/** Converts the app's tool definitions (Anthropic shape) to OpenAI function tools. */
export const toOpenAiTools = (tools = []) => tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }))

/** Calls any OpenAI-compatible /chat/completions endpoint. Also used by the Ollama provider. */
export async function callChatCompletions({ baseUrl, apiKey, model, maxTokens, system, messages, tools, signal }) {
  let res
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, ...messages],
        ...(tools?.length ? { tools: toOpenAiTools(tools) } : {}),
      }),
    })
  } catch (e) {
    throw new ProviderError(e.name === 'AbortError' ? 'timeout' : 'network')
  }
  if (!res.ok) throw new ProviderError(`provider_status_${res.status}`)
  const body = await res.json()
  const msg = body.choices?.[0]?.message || {}
  const toolCalls = []
  for (const c of msg.tool_calls || []) {
    try {
      toolCalls.push({ name: c.function.name, input: JSON.parse(c.function.arguments || '{}') })
    } catch {
      /* a malformed tool call is dropped; it can never reach the database */
    }
  }
  return { text: (msg.content || '').trim(), toolCalls, stopReason: body.choices?.[0]?.finish_reason }
}

export const openai = {
  name: 'openai',
  needsKey: true,
  defaultModel: 'gpt-4o-mini',
  call: (p) => callChatCompletions({ ...p, baseUrl: p.baseUrl || 'https://api.openai.com/v1' }),
}
