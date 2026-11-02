// Slice 1c: hardening of Community found by review. The SQL is checked STATICALLY (no Postgres in the build environment);
// run supabase/tests/slice1_rls.sql in Supabase to execute the same rules against a real database.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const sql = read('supabase/migrations/008_slice1_hardening.sql')
const policy = (name) => {
  const start = sql.indexOf(`create policy ${name} `)
  assert.ok(start >= 0, `policy ${name} is defined in 008`)
  return sql.slice(start, sql.indexOf(';', start))
}

test('008 is additive: no table/column is dropped, earlier migrations are untouched', () => {
  assert.doesNotMatch(sql, /drop\s+table|drop\s+column|truncate|delete\s+from/i)
  const files = fs.readdirSync(new URL('../supabase/migrations/', import.meta.url)).sort()
  assert.deepEqual(files.slice(0, 7), ['001_v1_foundation.sql', '002_v2.sql', '003_v3.sql', '004_v5.sql', '005_safe_mode_media.sql', '006_smart_actions.sql', '007_community.sql'])
  assert.equal(files[7], '008_slice1_hardening.sql')
})

test('a suspended member cannot delete their own profile to re-join as active', () => {
  const p = policy('community_profiles_delete')
  assert.match(p, /for delete/)
  assert.match(p, /user_id = \(select auth\.uid\(\)\) and status = 'active'/)
  assert.match(p, /community_is_admin\(\)/)
})

test('a banned group member cannot delete their own membership to re-join', () => {
  const p = policy('community_group_members_delete')
  assert.match(p, /user_id = \(select auth\.uid\(\)\) and status <> 'banned'/)
  assert.match(p, /community_is_group_mod\(group_id\)/)
})

test('editing a post cannot move it into a group the author does not belong to', () => {
  const p = policy('community_posts_update')
  const check = p.slice(p.indexOf('with check'))
  assert.match(check, /community_is_group_member\(group_id\)/)
  assert.match(check, /group_id is null/)
})

test('only the group owner (or an administrator) changes roles; membership rows cannot be re-pointed', () => {
  assert.match(sql, /create trigger community_group_members_guard before update on public\.community_group_members/)
  assert.match(sql, /membership_immutable/)
  assert.match(sql, /owner_only/)
  assert.match(sql, /community_is_group_owner[\s\S]*role = 'owner'/)
  assert.match(sql, /function public\.community_is_group_owner[\s\S]*set search_path = public/)
  assert.match(sql, /revoke all on function public\.community_is_group_owner\(uuid\) from public, anon/)
})

test('reaction notifications are one per person per post (toggling cannot flood the owner)', () => {
  assert.match(sql, /'community:react:' \|\| post::text \|\| ':' \|\| new\.user_id::text/)
  assert.match(sql, /on conflict \(user_id, dedupe_key\) do nothing/)
  assert.match(sql, /'\/community\?post=' \|\| post::text/)
})

test('every SECURITY DEFINER function in 008 pins search_path', () => {
  for (const chunk of sql.split('create or replace function public.').slice(1)) {
    const header = chunk.slice(0, chunk.indexOf('$$'))
    if (/security definer/i.test(header)) assert.match(header, /set search_path = public/, header.slice(0, 60))
  }
})

test('the client flows still work with the new guards: join/leave/approve never upsert or re-point membership rows', () => {
  const svc = read('src/services/community.js')
  assert.doesNotMatch(svc, /community_group_members'\)\.upsert/)
  assert.match(svc, /update\(\{ status: 'active' \}\)\.eq\('id', memberId\)/)
})

test('notification links open the post: /community?post=<uuid> is validated and shown, never trusted', () => {
  const page = read('src/pages/Community.jsx')
  assert.match(page, /params\.get\('post'\)/)
  assert.match(page, /isUuid\(postParam\)/)
  assert.match(page, /scope="post" postId=\{postId\}/)
  const svc = read('src/services/community.js')
  assert.match(svc, /scope === 'post'\) query = query\.eq\('id', postId\)/)
  assert.match(read('src/components/community/Feed.jsx'), /fetchPosts\(\{ scope, groupId, postId/)
})

test('the new Kiswahili phrase exists', () => {
  assert.match(read('src/i18n/sw.phrases.js'), /"This post is no longer available\.":/)
})

// ---------- scheduler: the channel and both buttons exist before the first snooze alarm ----------
import { createSnoozeScheduler as makeScheduler } from '../src/services/snoozeScheduler.js'
test('first native snooze registers the channel and the DO IT / REMIND ME AFTER 5M buttons once, before scheduling', async () => {
  const calls = []
  const plugin = {
    createChannel: async (a) => { calls.push(['channel', a.id]) },
    registerActionTypes: async (a) => { calls.push(['types', a.types[0].actions.map((x) => x.title).join('|')]) },
    cancel: async () => { calls.push(['cancel']) },
    schedule: async (a) => { calls.push(['schedule', a.notifications[0].channelId, a.notifications[0].actionTypeId]) },
  }
  const s = makeScheduler({ plugin })
  const at = new Date(Date.now() + 300000).toISOString()
  await s.schedule({ id: '11111111-1111-4111-8111-111111111111', title: 'T' }, at)
  await s.schedule({ id: '11111111-1111-4111-8111-111111111111', title: 'T' }, at)
  const names = calls.map((c) => c[0])
  assert.deepEqual(names.slice(0, 2), ['channel', 'types'], 'channel and buttons first')
  assert.equal(names.filter((x) => x === 'channel').length, 1, 'registered only once')
  assert.equal(calls.find((c) => c[0] === 'types')[1], 'DO IT|REMIND ME AFTER 5M')
  assert.equal(names.filter((x) => x === 'schedule').length, 2)
  assert.deepEqual(calls.find((c) => c[0] === 'schedule').slice(1), ['reminders', 'SMART_ACTION'])
})
test('a plugin without those methods still schedules (older plugin / web build)', async () => {
  let scheduled = 0
  const s = makeScheduler({ plugin: { cancel: async () => {}, schedule: async () => { scheduled += 1 } } })
  await s.schedule({ id: '22222222-2222-4222-8222-222222222222', title: 'T' }, new Date(Date.now() + 300000).toISOString())
  assert.equal(scheduled, 1)
})
test('slice1_rls.sql exists, is rolled back, and covers notifications, community moderation and the user_metadata trap', () => {
  const t = read('supabase/tests/slice1_rls.sql')
  assert.match(t.trim(), /rollback;$/)
  for (const w of ['notification_snooze', 'notification_begin_action', 'moderation_log', 'claims_fake', 'user_metadata']) assert.ok(t.includes(w), w)
})
