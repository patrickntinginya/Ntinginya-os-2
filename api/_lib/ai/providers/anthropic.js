import { ProviderError } from '../errors.js'

export const anthropic = {
  name: 'anthropic',
  needsKey: true,
  defaultModel: 'claude-sonnet-5-5',
  async call({ apiKey, model, maxTokens, system, messages, tools, signal }) {
    let res
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, tools }),
      })
    } catch (e) {
      throw new ProviderError(e.name === 'AbortError' ? 'timeout' : 'network')
    }
    if (!res.ok) throw new ProviderError(`provider_status_${res.status}`)
    const body = await res.json()
    const blocks = Array.isArray(body.content) ? body.content : []
    return {
      text: blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(),
      toolCalls: blocks.filter((b) => b.type === 'tool_use').map((b) => ({ name: b.name, input: b.input })),
      stopReason: body.stop_reason,
    }
  },
}
