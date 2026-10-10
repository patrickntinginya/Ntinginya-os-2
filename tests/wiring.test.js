import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { CONVERSIONS } from '../src/utils/convert.js'

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('every navigation item has a route in App.jsx', () => {
  // Read as text: navigation.js imports icons, which need node_modules.
  const paths = [...read('src/lib/navigation.js').matchAll(/to: '(\/[a-z/-]+)'/g)].map((m) => m[1])
  assert.ok(paths.length >= 10)
  for (const to of paths) assert.ok(app.includes(`path="${to}"`) || app.includes(`path="${to.replace(/\/daily$/, '/:kind')}"`), `missing route ${to}`)
})

test('every conversion kind used in a page exists', () => {
  const pages = readdirSync(new URL('../src/pages/', import.meta.url)).map((f) => read(`src/pages/${f}`)).join('\n')
  const used = [...pages.matchAll(/<ConvertButton kind="([a-z_]+)"/g)].map((m) => m[1])
  assert.ok(used.length >= 6, 'all six conversions should be reachable from the UI')
  for (const kind of used) assert.ok(CONVERSIONS[kind], `unknown conversion ${kind}`)
  for (const kind of Object.keys(CONVERSIONS)) assert.ok(used.includes(kind), `conversion ${kind} is not reachable in the UI`)
})

test('no AI secret is read in browser code', () => {
  const files = []
  const walk = (dir) => {
    for (const e of readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}/${e.name}`)
      else if (/\.(jsx?|html)$/.test(e.name)) files.push(`${dir}/${e.name}`)
    }
  }
  walk('src')
  for (const f of files) {
    const text = read(f)
    assert.ok(!/VITE_AI/.test(text), `${f} references a VITE_AI variable`)
    assert.ok(!/process\.env\.AI_API_KEY|import\.meta\.env\.[A-Z_]*AI_API_KEY/.test(text), `${f} reads the AI key`)
    assert.ok(!/service_role/i.test(text), `${f} mentions service_role`)
  }
})

test('the three SQL migrations exist and V3 enables RLS on the new tables', () => {
  const v3 = read('supabase/migrations/003_v3.sql')
  for (const t of ['habits', 'habit_entries']) {
    assert.ok(new RegExp(`'${t}'`).test(v3), `${t} not in the RLS loop`)
    assert.ok(v3.includes(`create table if not exists public.${t}`))
  }
  assert.ok(/delete_my_account/.test(v3) && /auth\.uid\(\)/.test(v3))
})

test('finance screens never default to a dollar currency', () => {
  const files = ['src/components/finance/IntelligenceTab.jsx', 'src/pages/Finance.jsx', 'src/utils/format.js']
  for (const f of files) assert.ok(!/USD|\$\{/.test(read(f).replace(/\$\{[^}]*\}/g, '')), `${f} mentions USD`)
})
