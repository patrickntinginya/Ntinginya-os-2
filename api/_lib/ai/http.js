// Turns a provider failure into an HTTP reply. The browser maps `error` to a translated message, so the
// English `message` is only a fallback. Provider text is never forwarded (it could echo request details).
export function providerErrorReply(err) {
  switch (err?.kind) {
    case 'rate_limit': return { status: 429, error: 'provider_rate_limited' }
    case 'timeout': return { status: 504, error: 'ai_timeout' }
    case 'auth': case 'model': case 'bad_request': return { status: 502, error: 'ai_config_error' }
    case 'not_ready': return { status: 503, error: 'ai_not_configured' }
    default: return { status: 502, error: 'ai_provider_error' }
  }
}

export const FALLBACK_MESSAGES = {
  provider_rate_limited: 'AI usage has reached its limit for now. Please try again later.',
  ai_timeout: 'The AI took too long to answer. Please try again.',
  ai_config_error: 'The AI service is not set up correctly. Check the server settings.',
  ai_not_configured: 'AI Assistant is not configured yet.',
  ai_provider_error: 'The AI service had a problem. Please try again.',
  daily_limit: 'You have reached the daily AI limit. Try again tomorrow.',
  burst_limit: 'You are sending messages too fast. Wait a moment and try again.',
}
