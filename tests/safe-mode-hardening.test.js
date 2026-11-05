import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const migrationPath = new URL(
  '../supabase/migrations/023_safe_mode_media_update_guard.sql',
  import.meta.url
)

const sql = fs.readFileSync(migrationPath, 'utf8')

const protectedColumns = [
  'id',
  'user_id',
  'media_type',
  'visibility',
  'storage_path',
  'mime_type',
  'size_bytes',
  'created_at',
]

test('all Safe Mode media metadata columns are immutable', () => {
  for (const column of protectedColumns) {
    assert.ok(
      sql.includes(`NEW.${column} IS DISTINCT FROM OLD.${column}`),
      `${column} must be protected`
    )
  }
})

test('title remains editable', () => {
  assert.doesNotMatch(
    sql,
    /NEW\.title\s+IS DISTINCT FROM OLD\.title/i
  )
})

test('protected metadata changes raise permission error', () => {
  assert.match(
    sql,
    /RAISE EXCEPTION 'safe_mode_media_metadata_immutable'/i
  )
  assert.match(sql, /USING ERRCODE = '42501'/i)
})

test('guard is attached to BEFORE UPDATE for each row', () => {
  assert.match(sql, /CREATE TRIGGER safe_mode_media_guard_update/i)
  assert.match(sql, /BEFORE UPDATE ON public\.safe_mode_media/i)
  assert.match(sql, /FOR EACH ROW/i)
  assert.match(
    sql,
    /EXECUTE FUNCTION public\.safe_mode_media_guard_update\(\)/i
  )
})

test('function has pinned search_path and no SECURITY DEFINER', () => {
  assert.match(sql, /SET search_path = pg_catalog, public/i)
  assert.doesNotMatch(sql, /SECURITY DEFINER/i)
})

test('client roles cannot directly execute the trigger function', () => {
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.safe_mode_media_guard_update\(\)\s+FROM PUBLIC, anon, authenticated, service_role/i
  )
})

test('migration is transactional and avoids destructive operations', () => {
  assert.match(sql.trim(), /^BEGIN;/i)
  assert.match(sql.trim(), /COMMIT;$/i)
  assert.doesNotMatch(
    sql,
    /DROP TABLE|TRUNCATE|DELETE FROM|DROP POLICY/i
  )
})
