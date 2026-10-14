// Provider abstraction. The rest of the app only calls resolveProvider() and callModel(); it never knows which
// vendor answers. Keys are read here from the server environment and never sent to the browser.
//
// AI_PROVIDER = gemini (default) | anthropic | openai | ollama | none
//   gemini     needs GEMINI_API_KEY   (model: GEMINI_MODEL, default below)
//   anthropic  needs AI_API_KEY       (model: AI_MODEL)
//   openai     needs AI_API_KEY       (model: AI_MODEL, optional AI_BASE_URL for compatible servers)
//   ollama     needs AI_BASE_URL      (model: AI_MODEL)
// If AI_PROVIDER is empty: GEMINI_API_KEY set -> gemini; else legacy AI_API_KEY set -> anthropic (V2/V3 compatible);
// else gemini (reported as "not configured").
import { anthropic } from './providers/anthropic.js'
import { openai } from './providers/openai.js'
import { ollama } from './providers/ollama.js'
import { gemini, MODEL_PATTERN } from './providers/gemini.js'
import { ProviderError } from './errors.js'

export { ProviderError }
export const PROVIDERS = { gemini, anthropic, openai, ollama }
export const KNOWN_NAMES = ['gemini', 'anthropic', 'openai', 'ollama', 'none']
export const DEFAULT_PROVIDER = 'gemini'

const clampInt = (v, fallback, min, max) => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= min ? Math.min(n, max) : fallback
}

/**
 * Describes the AI setup WITHOUT exposing secrets.
 * status: ready | disabled | not_configured | unsupported
 */
export function resolveProvider(env = process.env) {
  const requested = String(env.AI_PROVIDER || '').trim().toLowerCase()
  const name = requested || (env.GEMINI_API_KEY ? 'gemini' : env.AI_API_KEY ? 'anthropic' : DEFAULT_PROVIDER)
  const dailyLimit = clampInt(env.AI_DAILY_LIMIT, 100, 1, 1000)
  const impl = PROVIDERS[name]
  const maxTokens = clampInt(env.AI_MAX_TOKENS, impl?.defaultMaxTokens || 1400, 64, 4000)
  const base = { name, maxTokens, dailyLimit }

  if (name === 'none') return { ...base, status: 'disabled', configured: false }
  if (!impl) return { ...base, status: 'unsupported', configured: false }

  const apiKey = (impl.keyEnv ? env[impl.keyEnv] : env.AI_API_KEY) || ''
  const baseUrl = env.AI_BASE_URL || ''
  const model = (impl.modelEnv ? env[impl.modelEnv] : env.AI_MODEL) || impl.defaultModel
  if (impl.needsKey && !apiKey) return { ...base, status: 'not_configured', configured: false, missing: impl.keyEnv || 'AI_API_KEY' }
  if (impl.needsBaseUrl && !baseUrl) return { ...base, status: 'not_configured', configured: false, missing: 'AI_BASE_URL' }
  if (name === 'gemini' && !MODEL_PATTERN.test(model)) return { ...base, status: 'not_configured', configured: false, missing: 'GEMINI_MODEL' }
  // Only when the owner did not choose a model: allow one retry with a widely available model if the default is rejected.
  const fallbackModel = name === 'gemini' && !env.GEMINI_MODEL && impl.fallbackModel ? impl.fallbackModel : undefined
  return { ...base, status: 'ready', configured: true, model, apiKey, baseUrl, ...(fallbackModel ? { fallbackModel } : {}) }
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
