// Guards for the Android (Capacitor) foundation: the web app must stay intact and nothing secret may be committed.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { isNativePlatform } from '../src/lib/platform.js'

const root = new URL('../', import.meta.url).pathname
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')

test('capacitor.config.json uses the agreed appId and the Vite output folder', () => {
  const cfg = JSON.parse(read('capacitor.config.json'))
  assert.equal(cfg.appId, 'com.ntinginya.personallifeos')
  assert.equal(cfg.webDir, 'dist')
  assert.equal(cfg.server?.androidScheme, 'https')
  assert.ok(!cfg.server?.url, 'must bundle the app, not load a remote URL')
})

test('package.json keeps every original script and the web dependencies', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.scripts.dev, 'vite')
  assert.equal(pkg.scripts.build, 'vite build')
  assert.equal(pkg.scripts.preview, 'vite preview --host')
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.js')
  for (const dep of ['@supabase/supabase-js', 'react', 'react-dom', 'react-router-dom', 'lucide-react']) assert.ok(pkg.dependencies[dep], `${dep} missing`)
  for (const dep of ['vite', 'vite-plugin-pwa', '@vitejs/plugin-react']) assert.ok(pkg.devDependencies[dep], `${dep} missing`)
  assert.match(pkg.dependencies['@capacitor/core'], /^\^7\./)
  assert.match(pkg.dependencies['@capacitor/android'], /^\^7\./)
  assert.match(pkg.devDependencies['@capacitor/cli'], /^\^7\./)
})

test('the PWA service worker is still registered for the web build and skipped only on native', () => {
  const main = read('src/main.jsx')
  assert.match(main, /if \(!isNativePlatform\(\)\) registerSW\(\{ immediate: true \}\)/)
  assert.match(read('vite.config.js'), /VitePWA\(/)
})

test('isNativePlatform is false in a browser and true only when Capacitor says so', () => {
  assert.equal(isNativePlatform({}), false)
  assert.equal(isNativePlatform(undefined), false)
  assert.equal(isNativePlatform({ Capacitor: {} }), false)
  assert.equal(isNativePlatform({ Capacitor: { isNativePlatform: () => false } }), false)
  assert.equal(isNativePlatform({ Capacitor: { isNativePlatform: () => true } }), true)
  assert.equal(isNativePlatform({ Capacitor: { isNativePlatform: () => { throw new Error('x') } } }), false)
})

test('the APK workflow is debug-only, never runs for main, and uses no signing material', () => {
  const full = read('.github/workflows/android-debug-apk.yml')
  const wf = full.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n') // comments may mention the words below
  assert.match(wf, /branches:\s*\[Android-V1\]/)
  assert.ok(!/branches:[^\n]*\bmain\b/.test(wf), 'must not trigger on main')
  assert.match(wf, /assembleDebug/)
  assert.ok(!/assembleRelease|bundleRelease|storePassword|keyPassword|keystore|\.jks/i.test(wf), 'no release signing in Phase 1')
  assert.ok(!/SERVICE_ROLE|GEMINI|AI_API_KEY/i.test(wf), 'no server secret in the workflow')
  assert.match(wf, /upload-artifact/)
})

test('keystores and Android build output are git-ignored', () => {
  const ign = read('.gitignore')
  for (const p of ['*.jks', '*.keystore', 'keystore.properties', 'android/local.properties', 'android/app/build/']) assert.ok(ign.includes(p), `${p} not ignored`)
  assert.match(ign, /^\.env$/m)
})

test('the three original migrations keep their names; V5 adds exactly one additive file (004_v5.sql)', () => {
  assert.deepEqual(fs.readdirSync(path.join(root, 'supabase/migrations')).sort(), ['001_v1_foundation.sql', '002_v2.sql', '003_v3.sql', '004_v5.sql'])
})
