import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { AI_CONTEXT_CATEGORIES, normalizeAiContextCategories } from '../src/lib/ai/contextCategories.js'
import { buildContext } from '../api/_lib/ai/context.js'
import { handleSafeModeSupport } from '../api/safe-mode-support.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('AI context categories are an explicit allowlist and reject unknown or duplicate values', () => {
  assert.deepEqual(normalizeAiContextCategories(undefined), [])
  assert.deepEqual(normalizeAiContextCategories(['tasks', 'tasks', 'unapproved', 'finance']), ['tasks', 'finance'])
  assert.deepEqual(AI_CONTEXT_CATEGORIES, ['tasks', 'schedule', 'goals', 'habits', 'learning', 'finance', 'ideas'])
})

test('no selected categories causes no personal-data query', async () => {
  const client = { from() { throw new Error('personal table must not be queried') } }
  assert.deepEqual(await buildContext(client, { today: '2026-10-30', mode: 'chat', categories: [] }), { block: '', failed: [] })
})

test('context controls start unchecked and the selected categories are included in API requests', () => {
  const page = read('src/pages/AiAssistant.jsx')
  const selector = read('src/components/ai/AiContextSelector.jsx')
  const client = read('src/services/aiClient.js')
  assert.match(page, /useState\(\[\]\)/)
  assert.match(selector, /checked=\{categories\.includes\(category\)\}/)
  assert.match(selector, /AI_CONTEXT_CATEGORIES\.map/)
  assert.match(client, /context_categories: contextCategories/)
})

test('Safe Mode reflection sharing remains a separate explicit opt-in', () => {
  const component = read('src/components/SafeModeSupport.jsx')
  const endpoint = read('api/safe-mode-support.js')
  assert.match(component, /checked=\{personalize\}/)
  assert.match(component, /includePersonalContext: personalize/)
  assert.match(component, /sent to the configured AI provider for this request only/)
  assert.match(endpoint, /body\.includePersonalContext === true/)
})

test('authenticated crisis support is returned when the AI usage-limit RPC is unavailable', async () => {
  let rpcCalls = 0
  const userId = `crisis-${randomUUID()}`
  const env = {
    VITE_SUPABASE_URL: 'https://project.example',
    VITE_SUPABASE_ANON_KEY: 'test-anon-key',
  }
  const createClient = () => ({
    auth: {
      async getUser(token) {
        return token === 'valid-token'
          ? { data: { user: { id: userId } }, error: null }
          : { data: { user: null }, error: new Error('invalid token') }
      },
    },
    async rpc() {
      rpcCalls += 1
      throw new Error('usage-limit RPC unavailable')
    },
  })
  const request = (token) => new Request('https://app.example/api/safe-mode-support', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ mood: 'stress', lang: 'en', details: 'I want to kill myself' }),
  })

  const unauthorized = await handleSafeModeSupport(request('invalid-token'), env, { createClient })
  assert.equal(unauthorized.status, 401)

  const response = await handleSafeModeSupport(request('valid-token'), env, { createClient })
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.match(body.reply, /contact someone you trust/)
  assert.deepEqual(body.videos, [])
  assert.equal(body.searchUrl, null)
  assert.equal(rpcCalls, 0)
})

test('non-crisis Safe Mode AI still fails closed when the AI usage-limit RPC is unavailable', async () => {
  let rpcCalls = 0
  const env = {
    VITE_SUPABASE_URL: 'https://project.example',
    VITE_SUPABASE_ANON_KEY: 'test-anon-key',
  }
  const createClient = () => ({
    auth: { async getUser() { return { data: { user: { id: `safe-mode-${randomUUID()}` } }, error: null } } },
    async rpc() {
      rpcCalls += 1
      throw new Error('usage-limit RPC unavailable')
    },
  })
  const response = await handleSafeModeSupport(new Request('https://app.example/api/safe-mode-support', {
    method: 'POST',
    headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
    body: JSON.stringify({ mood: 'stress', lang: 'en', details: 'I feel overwhelmed today' }),
  }), env, { createClient })

  assert.equal(response.status, 503)
  assert.equal((await response.json()).error, 'usage_limit_unavailable')
  assert.equal(rpcCalls, 1)
})
