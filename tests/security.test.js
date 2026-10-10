// Static guards: secrets stay on the server, nothing in the browser bundle can reach an AI key or service-role key.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = new URL('../', import.meta.url).pathname
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
const read = (f) => fs.readFileSync(f, 'utf8')
const srcFiles = walk(path.join(root, 'src')).filter((f) => /\.(jsx?|css)$/.test(f))
const serverFiles = walk(path.join(root, 'netlify')).filter((f) => f.endsWith('.js'))

test('no AI key or service-role key is referenced by browser code', () => {
  for (const f of srcFiles) {
    const s = read(f)
    assert.ok(!/AI_API_KEY|AI_BASE_URL|SERVICE_ROLE|service_role/i.test(s), `${f} mentions a server secret`)
    assert.ok(!/import\.meta\.env\.VITE_AI/.test(s), `${f} reads a VITE_AI variable`)
  }
})
test('no VITE_ variable holds a secret anywhere in the project', () => {
  for (const f of [...srcFiles, ...serverFiles, path.join(root, '.env.example'), path.join(root, 'netlify.toml'), path.join(root, 'vite.config.js')]) {
    assert.ok(!/VITE_AI|VITE_[A-Z_]*(SECRET|SERVICE|PRIVATE)/.test(read(f)), `${f} defines a secret as a VITE_ variable`)
  }
})
test('.env is git-ignored and .env.example holds placeholders only', () => {
  assert.match(read(path.join(root, '.gitignore')), /^\.env$/m)
  const env = read(path.join(root, '.env.example'))
  assert.match(env, /^GEMINI_API_KEY=$/m)
  assert.ok(!/sk-[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{20,}/.test(env))
})
test('the AI function authenticates the caller and only ever uses the caller\'s own token', () => {
  const fn = read(path.join(root, 'netlify/functions/ai-chat.js'))
  assert.match(fn, /auth\.getUser\(token\)/)
  assert.match(fn, /global: \{ headers: \{ Authorization: `Bearer \$\{token\}` \} \}/)
  assert.ok(!/SERVICE_ROLE|service_role/i.test(fn))
  assert.match(fn, /status: 401|json\(401/)
})
test('the AI function validates proposed actions and never executes them', () => {
  const fn = read(path.join(root, 'netlify/functions/ai-chat.js'))
  assert.match(fn, /validateAction\(call\.name, call\.input\)/)
  assert.match(fn, /status.*pending|ai_action_requests/)
  assert.ok(!/\.delete\(\)/.test(fn.replace(/\/\/.*$/gm, '')), 'the AI function must not delete anything')
})
test('no raw HTML injection in the UI', () => {
  for (const f of srcFiles) assert.ok(!/dangerouslySetInnerHTML|innerHTML\s*=/.test(read(f)), `${f} injects raw HTML`)
})
test('AI actions cannot delete anything', async () => {
  const { ACTION_TYPES } = await import('../src/lib/ai/actions.js')
  for (const t of ACTION_TYPES) assert.ok(!/delete|remove|transfer|send/i.test(t), `${t} looks destructive`)
})
