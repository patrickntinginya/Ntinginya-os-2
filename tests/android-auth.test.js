// Android email-link (deep link) handling: URL building, parsing, the "this app asked for it" guard, and the handler.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  authRedirectUrl, consumeAuthPending, markAuthPending, parseAuthCallback, PENDING_TTL_MS, routeAfterCallback,
} from '../src/lib/authRedirect.js'
import { createAuthDeepLinkHandler } from '../src/services/authDeepLink.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const memoryStorage = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)) }
}
const S = 'com.ntinginya.personallifeos'
const RECOVERY = `${S}://reset-password#access_token=aaa.bbb.ccc&refresh_token=refresh123&expires_in=3600&token_type=bearer&type=recovery`

test('web redirect addresses are exactly what the app used before (origin + path)', () => {
  assert.equal(authRedirectUrl('login', { native: false, origin: 'https://my.site' }), 'https://my.site/login')
  assert.equal(authRedirectUrl('reset-password', { native: false, origin: 'https://my.site' }), 'https://my.site/reset-password')
})

test('native redirect addresses use the app scheme, never the WebView origin', () => {
  assert.equal(authRedirectUrl('login', { native: true, origin: 'https://localhost' }), `${S}://login`)
  assert.equal(authRedirectUrl('reset-password', { native: true, origin: 'https://localhost' }), `${S}://reset-password`)
  assert.throws(() => authRedirectUrl('dashboard', { native: true }))
})

test('parses a password-reset link and returns the tokens exactly once, in one place', () => {
  const p = parseAuthCallback(RECOVERY)
  assert.deepEqual([p.ok, p.path, p.kind, p.accessToken, p.refreshToken, p.error], [true, 'reset-password', 'recovery', 'aaa.bbb.ccc', 'refresh123', null])
})

test('parses a sign-up confirmation link; the fragment wins over the query', () => {
  const p = parseAuthCallback(`${S}://login?access_token=old&refresh_token=old#access_token=new.tok&refresh_token=newref&type=signup`)
  assert.deepEqual([p.kind, p.accessToken, p.refreshToken], ['signup', 'new.tok', 'newref'])
})

test('an error link keeps only the error code, never the free-text description', () => {
  const p = parseAuthCallback(`${S}://reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`)
  assert.deepEqual(p.error, { code: 'otp_expired' })
  assert.ok(!JSON.stringify(p).includes('invalid'))
  assert.equal(p.accessToken, null)
})

test('links that are not ours are ignored, including the WebView origin and look-alike schemes', () => {
  for (const url of [
    'https://localhost/reset-password#access_token=a&refresh_token=b', `${S}://dashboard#access_token=a&refresh_token=b`,
    'com.evil.app://login#access_token=a&refresh_token=b', `${S}.evil://login#access_token=a&refresh_token=b`, 'javascript:alert(1)', '', null, undefined, 42, {},
  ]) assert.equal(parseAuthCallback(url).ok, false, String(url))
})

test('malformed or oversized tokens are rejected', () => {
  assert.equal(parseAuthCallback(`${S}://login#access_token=a b&refresh_token=c&type=signup`).ok, false)
  assert.equal(parseAuthCallback(`${S}://login#access_token=<script>&refresh_token=c`).ok, false)
  assert.equal(parseAuthCallback(`${S}://login#access_token=${'a'.repeat(5000)}&refresh_token=c`).ok, false)
  assert.equal(parseAuthCallback(`${S}://login#${'x'.repeat(9000)}`).ok, false)
})

test('where the app goes next never contains tokens', () => {
  const route = (url) => routeAfterCallback(parseAuthCallback(url))
  assert.equal(route(RECOVERY), '/reset-password')
  assert.equal(route(`${S}://login#access_token=a&refresh_token=b&type=signup`), '/dashboard')
  assert.equal(route(`${S}://reset-password#error_code=otp_expired`), '/reset-password')
  assert.equal(route(`${S}://login#error_code=otp_expired`), '/login')
  assert.equal(route(`${S}://login`), '/login')
  for (const url of [RECOVERY, `${S}://login#access_token=a&refresh_token=b&type=signup`]) assert.ok(!/token/.test(route(url)))
})

test('a link is accepted only if this app asked for one, once for recovery, and not after 24 hours', () => {
  const storage = memoryStorage()
  const t0 = 1_700_000_000_000
  assert.equal(consumeAuthPending('recovery', { storage, now: t0 }), false)
  markAuthPending('recovery', { storage, now: t0 })
  assert.equal(consumeAuthPending('signup', { storage, now: t0 + 1000 }), false, 'wrong kind')
  assert.equal(consumeAuthPending('recovery', { storage, now: t0 + 1000 }), true)
  assert.equal(consumeAuthPending('recovery', { storage, now: t0 + 2000 }), false, 'a recovery request is used up')
  markAuthPending('signup', { storage, now: t0 })
  assert.equal(consumeAuthPending('signup', { storage, now: t0 + 5000 }), true)
  assert.equal(consumeAuthPending('signup', { storage, now: t0 + 6000 }), true, 'sign-up links may be tapped twice')
  assert.equal(consumeAuthPending('signup', { storage, now: t0 + PENDING_TTL_MS + 1 }), false, 'expired')
})

test('a broken or blocked storage never throws', () => {
  const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.equal(markAuthPending('recovery', { storage: broken }), false)
  assert.equal(consumeAuthPending('recovery', { storage: broken }), false)
  assert.equal(consumeAuthPending('recovery', { storage: undefined }), false)
})

function harness({ setSessionResult = { error: null }, now = 1_700_000_000_000 } = {}) {
  const storage = memoryStorage()
  const sessions = []
  const navigations = []
  const auth = { setSession: async (s) => { sessions.push(s); if (setSessionResult instanceof Error) throw setSessionResult; return setSessionResult } }
  const handler = createAuthDeepLinkHandler({ auth, navigate: (...a) => navigations.push(a), storage, now: () => now })
  return { storage, sessions, navigations, handler, now }
}

test('handler: a requested password-reset link signs in, goes to /reset-password, and tokens go only to setSession', async () => {
  const h = harness()
  markAuthPending('recovery', { storage: h.storage, now: h.now })
  const r = await h.handler(RECOVERY)
  assert.deepEqual([r.handled, r.reason], [true, 'signed_in'])
  assert.deepEqual(h.sessions, [{ access_token: 'aaa.bbb.ccc', refresh_token: 'refresh123' }])
  assert.deepEqual(h.navigations, [['/reset-password', { replace: true }]])
  assert.ok(!JSON.stringify(h.navigations).includes('aaa.bbb.ccc') && !JSON.stringify(r).includes('refresh123'))
})

test('handler: a link this app never asked for cannot sign anyone in (session-fixation guard)', async () => {
  const h = harness()
  const r = await h.handler(RECOVERY)
  assert.deepEqual([r.handled, r.reason], [false, 'not_requested'])
  assert.equal(h.sessions.length, 0)
  assert.equal(h.navigations.length, 0)
})

test('handler: the same link twice is processed once (no redirect loop)', async () => {
  const h = harness()
  markAuthPending('recovery', { storage: h.storage, now: h.now })
  await h.handler(RECOVERY)
  markAuthPending('recovery', { storage: h.storage, now: h.now })
  const again = await h.handler(RECOVERY)
  assert.equal(again.reason, 'already_handled')
  assert.equal(h.sessions.length, 1)
  assert.equal(h.navigations.length, 1)
})

test('handler: an expired or used link shows the existing "link expired" screen and never throws', async () => {
  for (const result of [{ error: new Error('expired') }, new Error('network')]) {
    const h = harness({ setSessionResult: result })
    markAuthPending('recovery', { storage: h.storage, now: h.now })
    const r = await h.handler(RECOVERY)
    assert.equal(r.reason, 'session_rejected')
    assert.deepEqual(h.navigations, [['/reset-password', { replace: true }]])
  }
})

test('handler: an error link navigates without trying to sign in', async () => {
  const h = harness()
  markAuthPending('recovery', { storage: h.storage, now: h.now })
  const r = await h.handler(`${S}://reset-password#error_code=otp_expired`)
  assert.deepEqual([r.reason, r.error], ['link_error', 'otp_expired'])
  assert.equal(h.sessions.length, 0)
  assert.deepEqual(h.navigations, [['/reset-password', { replace: true }]])
})

test('handler: sign-up confirmation signs in and opens the dashboard; unrelated links are ignored', async () => {
  const h = harness()
  markAuthPending('signup', { storage: h.storage, now: h.now })
  assert.equal((await h.handler(`${S}://login#access_token=a1.b2.c3&refresh_token=r9&type=signup`)).reason, 'signed_in')
  assert.deepEqual(h.navigations.at(-1), ['/dashboard', { replace: true }])
  assert.equal((await h.handler('https://localhost/login')).handled, false)
})

test('AuthContext uses the helper for both redirects, keeps email/password sign-in, and marks requests only on Android', () => {
  const ctx = read('src/contexts/AuthContext.jsx')
  assert.match(ctx, /emailRedirectTo: authRedirectUrl\('login'\)/)
  assert.match(ctx, /redirectTo: authRedirectUrl\('reset-password'\)/)
  assert.ok(!/window\.location\.origin/.test(ctx), 'no hard-coded web origin left in AuthContext')
  assert.match(ctx, /signInWithPassword\(\{ email, password \}\)/)
  assert.match(ctx, /if \(isNativePlatform\(\)\) markAuthPending\('signup'\)/)
  assert.match(ctx, /if \(isNativePlatform\(\)\) markAuthPending\('recovery'\)/)
  assert.match(read('src/lib/supabase.js'), /persistSession: true, autoRefreshToken: true, detectSessionInUrl: true/)
})
