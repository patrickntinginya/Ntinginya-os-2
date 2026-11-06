import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const path = new URL(
  '../supabase/migrations/024_safe_mode_media_storage_select_guard.sql',
  import.meta.url
)

const sql = fs.readFileSync(path, 'utf8')

test('migration is transactional', () => {
  assert.match(sql, /^BEGIN;/i)
  assert.match(sql.trim(), /COMMIT;$/i)
})

test('only Safe Mode SELECT policy is replaced', () => {
  assert.match(
    sql,
    /DROP POLICY IF EXISTS safe_mode_media_storage_select/i
  )
  assert.match(
    sql,
    /CREATE POLICY safe_mode_media_storage_select/i
  )
  assert.doesNotMatch(sql, /DROP POLICY.*(?:insert|update|delete)/i)
})

test('policy applies only to authenticated users and Safe Mode bucket', () => {
  assert.match(sql, /FOR SELECT\s+TO authenticated/i)
  assert.match(sql, /bucket_id = 'safe-mode-media'/i)
})

test('media must have a matching database record', () => {
  assert.match(sql, /EXISTS\s*\(/i)
  assert.match(sql, /media\.storage_path = name/i)
})

test('personal media requires matching owner and folder', () => {
  assert.match(sql, /storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/i)
  assert.match(sql, /media\.user_id = auth\.uid\(\)/i)
})

test('shared media requires shared visibility', () => {
  assert.match(sql, /storage\.foldername\(name\)\)\[1\] = 'shared'/i)
  assert.match(sql, /media\.visibility = 'shared'/i)
})
test('shared media requires matching owner folder', () => {
  assert.match(
    sql,
    /storage\.foldername\(name\)\)\[2\] = media\.user_id::text/i
  )
})
