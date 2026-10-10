import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { aiErrorMessage, AI_ERROR_TEXT } from '../src/services/aiErrors.js'
import { providerErrorReply, FALLBACK_MESSAGES } from '../netlify/lib/ai/http.js'
import { setActiveLang } from '../src/i18n/index.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const nav = read('src/lib/navigation.js')
const layout = read('src/layouts/AppLayout.jsx')

// ---------- AI is easy to find ----------
test('AI Assistant is a highlighted item in the main navigation and in the phone bottom bar', () => {
  assert.match(nav, /to: '\/ai', labelKey: 'nav\.ai'[^}]*highlight: true/)
  const bottom = nav.match(/BOTTOM_NAV_PATHS = \[([^\]]*)\]/)[1]
  assert.ok(bottom.includes("'/ai'"), 'AI must be in the bottom navigation')
  assert.ok(bottom.split(',').length <= 5, 'bottom bar stays compact')
  assert.ok(layout.includes('highlight'), 'the layout styles the highlighted item')
})

test('the old /ai-assistant address still opens the assistant, and /ai is routed', () => {
  const app = read('src/App.jsx')
  assert.match(app, /path="\/ai"/)
  assert.match(app, /\/ai-assistant/)
})

// ---------- language switcher ----------
test('the language switcher is global: phone header, desktop sidebar and the login screens', () => {
  assert.match(layout, /<LanguageSwitcher/)
  assert.ok((layout.match(/<LanguageSwitcher/g) || []).length >= 2, 'header and sidebar')
  assert.match(read('src/layouts/AuthLayout.jsx'), /<LanguageSwitcher/)
})

test('language buttons are large touch targets and accessible', () => {
  const sw = read('src/components/LanguageSwitcher.jsx')
  assert.match(sw, /min-h-\[44px\]/)
  assert.match(sw, /aria-pressed/)
  assert.match(sw, /role="group"/)
  assert.match(sw, /aria-label=\{l\.label\}/)
})

test('the whole app is wrapped in the language provider', () => {
  assert.match(read('src/main.jsx'), /<I18nProvider>/)
})

test('focus is visible and touch targets are at least 44px', () => {
  const css = read('src/index.css')
  assert.match(css, /:focus-visible/)
  assert.match(css, /min-h-\[48px\]/)
  assert.match(css, /\.icon-btn[\s\S]*h-11 w-11/)
})

// ---------- mobile navigation ----------
test('mobile navigation: bottom bar, More menu, safe-area padding, no hidden-only navigation', () => {
  assert.match(layout, /md:hidden/)
  assert.match(layout, /safe-area-inset-bottom/)
  assert.match(layout, /nav\.more/)
  assert.match(read('index.html'), /viewport-fit=cover/)
})

// ---------- PWA ----------
test('PWA: manifest, icons, standalone display, service worker, offline shell', () => {
  const vite = read('vite.config.js')
  for (const needle of ["name: 'Personal Life OS'", "display: 'standalone'", "start_url: '/dashboard'", "registerType: 'autoUpdate'", "navigateFallback: '/index.html'", 'purpose: \'maskable\'']) {
    assert.ok(vite.includes(needle), `vite.config.js is missing ${needle}`)
  }
  assert.match(vite, /navigateFallbackDenylist:[^\]]*netlify/)
  for (const size of [192, 512]) {
    const file = `public/pwa-${size}.png`
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${file} missing`)
    const png = readFileSync(new URL(`../${file}`, import.meta.url))
    assert.equal(png.readUInt32BE(16), size)
    assert.equal(png.readUInt32BE(20), size)
  }
  assert.ok(existsSync(new URL('../public/pwa-maskable-512.png', import.meta.url)))
  const html = read('index.html')
  assert.match(html, /name="theme-color"/)
  assert.match(html, /apple-touch-icon/)
  assert.match(read('src/main.jsx'), /registerSW/)
})

test('offline: a clear bilingual banner says data needs internet', () => {
  const banner = read('src/components/OfflineBanner.jsx')
  assert.match(banner, /navigator\.onLine/)
  assert.match(banner, /addEventListener\('offline'/)
  const phrase = banner.match(/tr\('([^']+)'\)/)[1]
  const sw = read('src/i18n/sw.phrases.js')
  assert.ok(sw.includes(JSON.stringify(phrase)), 'Kiswahili offline text is missing')
  assert.match(sw, /offline/i)
})

test('Netlify: build, publish folder, functions folder and SPA redirect are unchanged in shape', () => {
  const toml = read('netlify.toml')
  assert.match(toml, /command = "npm run build"/)
  assert.match(toml, /publish = "dist"/)
  assert.match(toml, /directory = "netlify\/functions"/)
  assert.match(toml, /from = "\/\*"\s*\n\s*to = "\/index\.html"/)
})

// ---------- Gemini / secrets ----------
test('Gemini secrets: no VITE_ AI/Gemini variable anywhere, key only read in the server provider code', () => {
  const walk = (dir, out = []) => {
    for (const e of readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
      if (['node_modules', 'dist'].includes(e.name)) continue
      if (e.isDirectory()) walk(`${dir}/${e.name}`, out)
      else if (/\.(jsx?|html|toml|md|example)$/.test(e.name) || e.name === '.env.example') out.push(`${dir}/${e.name}`)
    }
    return out
  }
  const all = [...walk('src'), ...walk('netlify'), ...walk('docs'), 'index.html', 'vite.config.js', 'netlify.toml', '.env.example', 'README.md']
  for (const f of all) {
    const text = read(f)
    assert.ok(!/VITE_(GEMINI|AI)[A-Z_]*\s*=/.test(text) && !/import\.meta\.env\.VITE_(GEMINI|AI)/.test(text), `${f} uses a VITE_ AI variable`)
  }
  for (const f of walk('src')) assert.ok(!/GEMINI_API_KEY/.test(read(f)), `${f} (browser code) mentions GEMINI_API_KEY`)
  const users = all.filter((f) => f.startsWith('netlify/') && /process\.env\.GEMINI_API_KEY|GEMINI_API_KEY/.test(read(f)))
  assert.ok(users.every((f) => f.includes('provider')), `GEMINI_API_KEY is read outside the provider layer: ${users}`)
})

test('.env.example lists the Gemini variables with empty values only', () => {
  const env = read('.env.example')
  for (const name of ['AI_PROVIDER', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'AI_MAX_TOKENS', 'AI_DAILY_LIMIT']) assert.match(env, new RegExp(`^${name}=`, 'm'))
  assert.match(env, /^GEMINI_API_KEY=$/m)
  assert.ok(!/^VITE_(GEMINI|AI)/m.test(env))
})

test('no key-like value is committed anywhere in the project', () => {
  const walk = (dir, out = []) => {
    for (const e of readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
      if (['node_modules', 'dist'].includes(e.name)) continue
      if (e.isDirectory()) walk(`${dir}/${e.name}`, out)
      else if (statSync(new URL(`../${dir}/${e.name}`, import.meta.url)).size < 400000 && /\.(jsx?|md|toml|sql|html|example|json)$/.test(e.name)) out.push(`${dir}/${e.name}`)
    }
    return out
  }
  for (const f of [...walk('src'), ...walk('netlify'), ...walk('docs'), ...walk('supabase'), ...walk('tests'), '.env.example', 'README.md']) {
    const text = read(f)
    assert.ok(!/AIza[0-9A-Za-z_-]{30,}/.test(text), `${f} contains a Google API key pattern`)
    assert.ok(!/sk-[A-Za-z0-9]{30,}/.test(text), `${f} contains a secret key pattern`)
    assert.ok(!/eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}/.test(text), `${f} contains a JWT`)
  }
})

// ---------- AI errors and limits reach the user in their language ----------
test('every error code the server can send has a translated message in both languages', () => {
  const codes = ['provider_rate_limited', 'ai_timeout', 'ai_config_error', 'ai_provider_error', 'ai_not_configured']
  for (const kind of ['rate_limit', 'timeout', 'auth', 'model', 'bad_request', 'not_ready', 'other']) {
    const r = providerErrorReply({ kind })
    assert.ok(AI_ERROR_TEXT[r.error], `no message for ${r.error}`)
    assert.ok(FALLBACK_MESSAGES[r.error] || codes.includes(r.error))
  }
  for (const code of Object.keys(FALLBACK_MESSAGES)) assert.ok(AI_ERROR_TEXT[code], `browser cannot show ${code}`)
  setActiveLang('sw')
  assert.match(aiErrorMessage('provider_rate_limited'), /kikomo/)
  assert.match(aiErrorMessage('ai_timeout'), /muda mrefu/)
  assert.equal(aiErrorMessage('something_new'), 'Kuna tatizo. Tafadhali jaribu tena.')
  setActiveLang('en')
  assert.match(aiErrorMessage('provider_rate_limited'), /usage limit/)
})

test('AI never writes to user data tables: the function only inserts into AI tables', () => {
  const fn = read('netlify/functions/ai-chat.js')
  const writes = [...fn.matchAll(/\.from\('([a-z_]+)'\)\s*\.(insert|update|delete|upsert)/g)].map((m) => m[1])
  assert.ok(writes.length > 0)
  for (const t of writes) assert.ok(['ai_conversations', 'ai_messages', 'ai_action_requests'].includes(t), `AI function writes to ${t}`)
  assert.ok(!/\.delete\(/.test(fn), 'AI function must not delete')
})

test('confirming an action is a separate, user-clicked step', () => {
  const card = read('src/components/ai/AiActionCard.jsx')
  assert.match(card, /confirmAction/)
  assert.match(card, /cancelAction/)
  const svc = read('src/services/aiActions.js')
  assert.match(svc, /status.*pending|pending/)
})

test('AI failures reach the screen with their translated message (not the generic fallback)', () => {
  const client = read('src/services/aiClient.js')
  assert.match(client, /class AiError extends Error/)
  assert.match(client, /throw new AiError\(aiErrorMessage\(body\?\.error\)\)/)
  assert.match(client, /lang: getLang\(\)/, 'the language is sent so the model answers in it')
  for (const f of ['src/pages/AiAssistant.jsx', 'src/components/ai/AskAiPanel.jsx']) assert.match(read(f), /instanceof AiError/)
})
