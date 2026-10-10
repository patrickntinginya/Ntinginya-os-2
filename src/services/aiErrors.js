// Messages for AI failures. The server sends a short error CODE; the browser turns it into text in the active language.
// (Server text is never trusted or forwarded: provider messages could echo request details.)
import { tr } from '../i18n/index.js'

const LIMIT = 'Your AI usage limit has been reached. Please try again later.'

export const AI_ERROR_TEXT = {
  provider_rate_limited: LIMIT,
  rate_limited: LIMIT,
  daily_limit: LIMIT,
  burst_limit: 'You are sending messages too fast. Wait a moment and try again.',
  ai_timeout: 'The AI took too long to answer. Please try again.',
  ai_config_error: 'The AI service is not set up correctly. Please contact the app owner.',
  ai_provider_error: 'The AI service had a problem. Please try again.',
  ai_disabled: 'AI is turned off in your settings.',
  ai_not_configured: 'AI Assistant is not configured yet.',
  unauthorized: 'Your session has expired. Please sign in again.',
  too_large: 'That message is too long.',
  bad_request: 'Please check your message and try again.',
  not_found: 'That conversation was not found.',
}

export const AI_GENERIC = 'Something went wrong. Please try again.'

export const aiErrorMessage = (code) => tr(AI_ERROR_TEXT[code] || AI_GENERIC)
