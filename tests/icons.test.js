// Every icon the app imports must exist in the REAL lucide-react package. This needs the package, so without `npm ci` it is reported as SKIPPED
// (never as passed): a skipped result in the test report means "not verified".
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (fs.statSync(p).isDirectory()) walk(p, out); else if (/\.jsx?$/.test(f)) out.push(p) }
  return out
}
const names = new Set()
for (const file of walk(new URL('../src', import.meta.url).pathname)) {
  const src = fs.readFileSync(file, 'utf8')
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g)) for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/)[0]; if (n) names.add(n) }
}

test('every lucide-react icon imported by the app exists in the installed package', async (t) => {
  let lib
  try { lib = await import('lucide-react') } catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND') { t.skip('lucide-react is not installed (run npm ci); icon names are NOT verified'); return }
    throw e
  }
  assert.ok(names.size > 40, 'icons were found in the source')
  assert.deepEqual([...names].filter((n) => !(n in lib)).sort(), [], 'icons missing from lucide-react')
})
