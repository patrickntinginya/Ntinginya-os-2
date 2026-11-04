// Provider abstraction. The rest of the app only calls resolveProvider() and callModel(); it never knows which
// vendor answers. Keys are read here from the server environment and never sent to the browser.
//
// AI_PROVIDER = gemini (default) | openrouter | anthropic | openai | ollama | none
//   gemini     needs GEMINI_API_KEY   (model: GEMINI_MODEL, default below)
//   openrouter needs OPENROUTER_API_KEY and OPENROUTER_MODEL (no guessed default; the upstream URL is fixed in code)
//   anthropic  needs AI_API_KEY       (model: AI_MODEL)
//   openai     needs AI_API_KEY       (model: AI_MODEL, optional AI_BASE_URL for compatible servers)
//   ollama     needs AI_BASE_URL      (model: AI_MODEL)
// Automatic app routing uses only Gemini and OpenRouter. A legacy AI_API_KEY does not enable Anthropic implicitly.
import { anthropic } from './providers/anthropic.js'
import { openai } from './providers/openai.js'
import { ollama } from './providers/ollama.js'
import { gemini, MODEL_PATTERN } from './providers/gemini.js'
import { openrouter, OPENROUTER_MODEL_PATTERN } from './providers/openrouter.js'
import { ProviderError } from './errors.js'

export { ProviderError }
export const PROVIDERS = { gemini, openrouter, anthropic, openai, ollama }
export const KNOWN_NAMES = ['gemini', 'openrouter', 'anthropic', 'openai', 'ollama', 'none']
export const DEFAULT_PROVIDER = 'gemini'

const clampInt = (v, fallback, min, max) => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= min ? Math.min(n, max) : fallback
}

/**
 * Describes one NAMED provider's setup WITHOUT exposing secrets (the router uses this to look at gemini and
 * openrouter side by side). status: ready | disabled | not_configured | unsupported
 */
export function resolveNamed(name, env = process.env) {
  const dailyLimit = clampInt(env.AI_DAILY_LIMIT, 100, 1, 1000)
  const impl = Object.hasOwn(PROVIDERS, name) ? PROVIDERS[name] : undefined
  const maxTokens = clampInt(env.AI_MAX_TOKENS, impl?.defaultMaxTokens || 1400, 64, 4000)
  const base = { name, maxTokens, dailyLimit }

  if (name === 'none') return { ...base, status: 'disabled', configured: false }
  if (!impl) return { ...base, status: 'unsupported', configured: false }

  const apiKey = (impl.keyEnv ? env[impl.keyEnv] : env.AI_API_KEY) || ''
  // OpenRouter's address is fixed in its adapter: AI_BASE_URL must never redirect it.
  const baseUrl = name === 'openrouter' ? '' : env.AI_BASE_URL || ''
  const model = (impl.modelEnv ? env[impl.modelEnv] : env.AI_MODEL) || impl.defaultModel
  if (impl.needsKey && !apiKey) return { ...base, status: 'not_configured', configured: false, missing: impl.keyEnv || 'AI_API_KEY' }
  if (impl.needsBaseUrl && !baseUrl) return { ...base, status: 'not_configured', configured: false, missing: 'AI_BASE_URL' }
  if (name === 'gemini' && !MODEL_PATTERN.test(model)) return { ...base, status: 'not_configured', configured: false, missing: 'GEMINI_MODEL' }
  if (name === 'openrouter' && !OPENROUTER_MODEL_PATTERN.test(model || '')) return { ...base, status: 'not_configured', configured: false, missing: 'OPENROUTER_MODEL' }
  // Only when the owner did not choose a model: allow one retry with a widely available model if the default is rejected.
  const fallbackModel = name === 'gemini' && !env.GEMINI_MODEL && impl.fallbackModel ? impl.fallbackModel : undefined
  return { ...base, status: 'ready', configured: true, model, apiKey, baseUrl, ...(fallbackModel ? { fallbackModel } : {}) }
}

/**
 * Describes the primary AI setup (AI_PROVIDER, or the key-based default) WITHOUT exposing secrets.
 * status: ready | disabled | not_configured | unsupported
 */
export function resolveProvider(env = process.env) {
  const requested = String(env.AI_PROVIDER || '').trim().toLowerCase()
  const name = requested || DEFAULT_PROVIDER
  return resolveNamed(name, env)
}

/** Only these fields are safe to send to the browser. `missing` is a variable NAME, never a value. */
export const publicStatus = (cfg) => ({
  provider: cfg.name,
  status: cfg.status,
  configured: cfg.configured,
  model: cfg.model || null,
  dailyLimit: cfg.dailyLimit,
  missing: cfg.missing || null,
})

/** Calls the selected provider. Returns { text, toolCalls: [{name, input}], stopReason }. */
export async function callModel(cfg, { system, messages, tools, timeoutMs = 24000, maxTokens }) {
  if (cfg.status !== 'ready') throw new ProviderError('not_ready')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const run = (model) => PROVIDERS[cfg.name].call({
    apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model, maxTokens: maxTokens || cfg.maxTokens, system, messages, tools, signal: controller.signal,
  })
  try {
    try {
      return await run(cfg.model)
    } catch (e) {
      if (e instanceof ProviderError && e.kind === 'model' && cfg.fallbackModel) return await run(cfg.fallbackModel)
      throw e
    }
  } finally {
    clearTimeout(timer)
  }
}

// Kept for older imports.
export const isConfigured = (env = process.env) => resolveProvider(env).configured
