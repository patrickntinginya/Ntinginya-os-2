// Turns an Android deep link into a signed-in session, safely. Dependencies are injected so it can be unit-tested.
//  - ignores anything that is not an auth link for this app, or that this app did not ask for (see authRedirect.js)
//  - never logs, stores or navigates with tokens
//  - the same link is only processed once per app run, so a re-delivered link cannot cause a redirect loop
import { consumeAuthPending, parseAuthCallback, routeAfterCallback } from '../lib/authRedirect.js'

export function createAuthDeepLinkHandler({ auth, navigate, storage, now = Date.now }) {
  const seen = new Set()
  return async function handleUrl(url) {
    const parsed = parseAuthCallback(url)
    if (!parsed.ok) return { handled: false, reason: parsed.reason }

    if (seen.has(url)) return { handled: false, reason: 'already_handled' }
    seen.add(url)
    if (seen.size > 20) seen.delete(seen.values().next().value)

    if (!consumeAuthPending(parsed.kind, { storage, now: now() })) return { handled: false, reason: 'not_requested' }

    if (parsed.error) {
      navigate(routeAfterCallback(parsed), { replace: true })
      return { handled: true, reason: 'link_error', error: parsed.error.code }
    }
    if (!parsed.accessToken) {
      navigate(routeAfterCallback(parsed), { replace: true })
      return { handled: true, reason: 'no_tokens' }
    }
    try {
      const { error } = await auth.setSession({ access_token: parsed.accessToken, refresh_token: parsed.refreshToken })
      if (error) throw error
    } catch {
      // Expired or already-used link. Send the user to the screen that explains it; no detail, no tokens.
      navigate(parsed.kind === 'recovery' ? '/reset-password' : '/login', { replace: true })
      return { handled: true, reason: 'session_rejected' }
    }
    navigate(routeAfterCallback(parsed), { replace: true })
    return { handled: true, reason: 'signed_in' }
  }
}
