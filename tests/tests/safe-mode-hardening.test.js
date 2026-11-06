import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const path = new URL(
  '../../supabase/migrations/023_safe_mode_media_update_guard.sql',
  import.meta.url
)

const sql = fs.readFileSync(path, 'utf8')

test('Safe Mode media metadata is immutable on update', () => {
  for (const field of [
    'id',
    'user_id',
    'media_type',
    'visibility',
    'storage_path',
    'mime_type',
    'size_bytes',
    'created_at',
  ]) {
    assert.match(
      sql,
      new RegExp(`NEW\\.${field}\\s+IS DISTINCT FROM OLD\\.${field}`)
    )
  }
})

test('Safe Mode title remains editable', () => {
  assert.doesNotMatch(
    sql,
    /NEW\.title\s+IS DISTINCT FROM OLD\.title/i
  )
})

test('Guard uses a pinned search path and BEFORE UPDATE trigger', () => {
  assert.match(sql, /SET search_path = pg_catalog, public/i)
  assert.match(sql, /BEFORE UPDATE ON public\.safe_mode_media/i)
  assert.match(sql, /EXECUTE FUNCTION public\.safe_mode_media_guard_update/i)
})

test('Guard does not use SECURITY DEFINER or destructive operations', () => {
  assert.doesNotMatch(sql, /SECURITY DEFINER/i)
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE/i)
  assert.match(sql, /REVOKE ALL ON FUNCTION/i)
})
