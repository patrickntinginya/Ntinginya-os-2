// Static checks for the offline library screens (no browser here): every string exists in both languages, nothing navigates away,
// every download failure code the core can return has a message, and online-only media is never offered for download.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const page = read('src/pages/SafeMode.jsx'); const lib = read('src/components/media/MediaLibrary.jsx'); const core = read('src/lib/offlineMedia.js')
const block = (lang) => { const i = page.indexOf(`  ${lang}: {`); const j = page.indexOf('\n  }', i); return page.slice(i, j) }
const keysOf = (b) => new Set([...b.matchAll(/\b([a-zA-Z_][\w]*):\s*'/g)].map((m) => m[1]))

test('Safe Mode copy: English and Kiswahili define exactly the same keys', () => {
  const en = keysOf(block('en')); const sw = keysOf(block('sw'))
  assert.deepEqual([...en].filter((k) => !sw.has(k)), [], 'missing in sw')
  assert.deepEqual([...sw].filter((k) => !en.has(k)), [], 'missing in en')
})
test('every c.<key> the library uses exists in the copy', () => {
  const en = keysOf(block('en'))
  const used = new Set([...lib.matchAll(/\bc\.([a-zA-Z_]\w*)/g)].map((m) => m[1]))
  assert.deepEqual([...used].filter((k) => !en.has(k)), [])
})
test('every failure code the core can return has a message', () => {
  const en = keysOf(block('en'))
  const codes = new Set([...core.matchAll(/failed\(item, '(\w+)'\)/g)].map((m) => m[1]).concat([...core.matchAll(/'(missing|expired|http)'/g)].map((m) => m[1]), ['not_allowed', 'not_cloud', 'unsupported', 'evicted']))
  for (const code of codes) assert.ok(en.has(`dl_${code}`), `dl_${code}`)
})
test('the library never navigates away: no anchors, no target=_blank, no window.open', () => {
  for (const src of [lib, page]) { assert.ok(!/target=["']_blank/.test(src)); assert.ok(!/<a\s/.test(src)); assert.ok(!/window\.open/.test(src)) }
})
test('only cloud files are downloadable: the download button needs a cloud list, support and a connection; links/YouTube are not in this list at all', () => {
  assert.match(lib, /cloudOk && offline\.supported && \(state === 'cloud' \|\| state === 'failed'\) && online/)
  assert.ok(!/youtube/i.test(lib.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'no YouTube handling in the downloadable library code')
  assert.match(core, /downloadability/)
})
test('the cloud list is requested with a limit and deletions are only synced after a successful load', () => {
  assert.match(page, /\.limit\(CLOUD_LIST_LIMIT\)/)
  assert.match(page, /syncOffline\(data \|\| \[\], true\)/)
  const catchAt = page.indexOf('setCloudOk(false)'); const syncAt = page.indexOf('syncOffline(')
  assert.ok(syncAt < catchAt && syncAt > page.indexOf('if (queryError) throw queryError'), 'sync sits after the error check, inside the try')
})
test('files live in a per-user IndexedDB database', () => {
  const store = read('src/lib/offlineStore.js')
  assert.match(store, /\$\{prefix\}-\$\{String\(userId\)/, 'the user id is part of the database name')
  assert.match(store, /prefix = 'ntinginya-offline-media'/, 'Safe Mode keeps its own database name')
  assert.match(read('src/hooks/useOfflineMedia.js'), /createIndexedDbStore\(userId, dbPrefix\)/)
  assert.match(read('src/lib/voiceOffline.js'), /VOICE_DB_PREFIX = 'ntinginya-offline-voice'/, 'chat voice messages live in a separate per-user database')
})
