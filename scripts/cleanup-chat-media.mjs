#!/usr/bin/env node
// Deletes chat attachments that no message points at any more (failed sends, messages deleted by people who had already left).
// Uses the SERVICE ROLE key: run it from a trusted place (your computer, a scheduled job), NEVER from the app, and never commit the key.
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/cleanup-chat-media.mjs            (dry run: only lists)
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/cleanup-chat-media.mjs --delete                          (really deletes)
// STATUS: written, not yet run against a real project. Try the dry run first on a disposable project.
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const really = process.argv.includes('--delete')
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'); process.exit(2) }
const headers = { apikey: key, Authorization: `Bearer ${key}` }

const list = await fetch(`${url}/rest/v1/chat_media_unattached?select=name,created_at&order=created_at.asc&limit=500`, { headers })
if (!list.ok) { console.error('Could not read chat_media_unattached:', list.status, await list.text()); process.exit(1) }
const rows = await list.json()
console.log(`${rows.length} unattached chat file(s)${rows.length === 500 ? ' (showing the first 500; run again afterwards)' : ''}.`)
for (const r of rows.slice(0, 20)) console.log(' ', r.created_at, r.name)
if (!really) { console.log('Dry run: nothing deleted. Add --delete to delete them.'); process.exit(0) }

let removed = 0
for (let i = 0; i < rows.length; i += 100) {
  const batch = rows.slice(i, i + 100).map((r) => r.name)
  const res = await fetch(`${url}/storage/v1/object/chat-media`, { method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: batch }) })
  if (!res.ok) { console.error('Delete failed:', res.status, await res.text()); process.exit(1) }
  removed += batch.length
}
console.log(`Deleted ${removed} file(s).`)
