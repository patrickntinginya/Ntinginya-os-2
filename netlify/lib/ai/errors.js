/** Maps an HTTP status from a model provider to a coarse kind the function can turn into a friendly message. */
export function kindFromStatus(status) {
  if (status === 429) return 'rate_limit'
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'model'
  if (status === 408 || status === 504) return 'timeout'
  if (status >= 500) return 'server'
  return 'bad_request'
}

/**
 * Thrown by providers. `message` is a short code (never provider text, never a key); `kind` drives the HTTP reply:
 * rate_limit | timeout | network | server | auth | model | bad_request | not_ready
 */
export class ProviderError extends Error {
  constructor(message, kind) {
    super(message)
    this.name = 'ProviderError'
    const m = /^provider_status_(\d+)$/.exec(message)
    this.kind = kind || (m ? kindFromStatus(Number(m[1])) : ['timeout', 'network', 'not_ready'].includes(message) ? message : 'server')
  }
}
