import { callChatCompletions } from './openai.js'

// Ollama exposes an OpenAI-compatible API. It only works if the Ollama server is reachable FROM the Netlify function
// (a public or tunnelled URL). A server on your own laptop (localhost) is not reachable from Netlify's cloud.
export const ollama = {
  name: 'ollama',
  needsKey: false,
  needsBaseUrl: true,
  defaultModel: 'llama3.1',
  call: (p) => callChatCompletions({ ...p, apiKey: p.apiKey || '' }),
}
