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
function canReadMedia(authUid, bucketId, objectName, records) {
  if (bucketId !== 'safe-mode-media') return false

  const folders = objectName.split('/')
  const media = records.find(
    record => record.storage_path === objectName
  )

  if (!media) return false

  const personal =
    folders[0] === authUid &&
    media.user_id === authUid

  const shared =
    folders[0] === 'shared' &&
    folders[1] === media.user_id &&
    media.visibility === 'shared'

  return personal || shared
}

const userA = 'user-a'
const userB = 'user-b'

const records = [
  {
    user_id: userA,
    visibility: 'personal',
    storage_path: 'user-a/video.mp4'
  },
  {
    user_id: userA,
    visibility: 'shared',
    storage_path: 'shared/user-a/shared.mp4'
  }
]

test('owner can read personal media', () => {
  assert.equal(
    canReadMedia(userA, 'safe-mode-media', 'user-a/video.mp4', records),
    true
  )
})

test('another user cannot read personal media', () => {
  assert.equal(
    canReadMedia(userB, 'safe-mode-media', 'user-a/video.mp4', records),
    false
  )
})

test('authenticated user can read approved shared media', () => {
  assert.equal(
    canReadMedia(userB, 'safe-mode-media', 'shared/user-a/shared.mp4', records),
    true
  )
})

test('shared media requires matching owner folder', () => {
  assert.equal(
    canReadMedia(userB, 'safe-mode-media', 'shared/user-b/shared.mp4', records),
    false
  )
})

test('object without database record cannot be read', () => {
  assert.equal(
    canReadMedia(userA, 'safe-mode-media', 'user-a/orphan.mp4', records),
    false
  )
})

test('media from another bucket cannot be read', () => {
  assert.equal(
    canReadMedia(userA, 'chat-media', 'user-a/video.mp4', records),
    false
  )
})
