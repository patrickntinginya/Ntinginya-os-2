// Slice 1 corrections (migration 009). SQL is checked STATICALLY here; supabase/tests/slice1_rls.sql executes the same rules on a real database.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { doItCore } from '../src/lib/smartActionCore.js'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const sql = read('supabase/migrations/009_slice1_security.sql')
const code = sql.replace(/--.*$/gm, '')
const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'

// ---------- A. storage ----------
test('009 replaces the open community-media read policy with a function that checks ownership, admin, post visibility, groups, blocks and avatars', () => {
  assert.match(code, /drop policy if exists community_media_select on storage\.objects;\s*create policy community_media_select on storage\.objects for select to authenticated\s*using \(bucket_id = 'community-media' and public\.community_can_read_media\(name\)\)/)
  const fn = code.slice(code.indexOf('function public.community_can_read_media'), code.indexOf('revoke all on function public.community_can_read_media'))
  for (const part of [/storage\.foldername\(obj_name\)\)\[1\] = auth\.uid\(\)::text/, /community_is_admin\(\)/, /p\.media_path = obj_name/, /p\.status = 'visible'/, /not public\.community_blocked\(p\.user_id\)/, /community_is_group_member\(p\.group_id\)/, /g\.privacy = 'public' and g\.status = 'active'/, /pr\.avatar_path = obj_name/, /pr\.status = 'active'/, /not public\.community_blocked\(pr\.user_id\)/]) assert.match(fn, part)
  assert.ok(!/using \(bucket_id = 'community-media'\)/.test(code), 'no policy allows the whole bucket')
  assert.match(code, /pin|set search_path = public, pg_temp/)
})
test('the old broad policy exists only in 007 and is superseded by 009 (migrations run in order)', () => {
  assert.match(read('supabase/migrations/007_community.sql'), /community_media_select on storage\.objects for select to authenticated using \(bucket_id = 'community-media'\)/)
  assert.ok(code.indexOf('drop policy if exists community_media_select') < code.indexOf('create policy community_media_select'))
})
test('signed URLs are short-lived (they can only be minted for objects the select policy allows)', () => {
  const svc = read('src/services/community.js')
  assert.match(svc, /signedUrls\(paths, seconds = (\d+)\)/)
  assert.ok(Number(svc.match(/signedUrls\(paths, seconds = (\d+)\)/)[1]) <= 900, 'signed URLs live at most 15 minutes')
})

// ---------- B. private groups ----------
test('private-group rule is stated once and every layer follows it: discoverable name, members-only content', () => {
  assert.match(sql, /DISCOVERABLE/); assert.match(sql, /members-only/)
  const s7 = read('supabase/migrations/007_community.sql')
  assert.match(s7, /community_groups_select on public\.community_groups for select to authenticated using \(status = 'active'/) // discoverable
  assert.match(s7, /community_posts_select[\s\S]{0,700}community_is_group_member\(group_id\)/)                                   // content members-only
  assert.match(s7, /community_group_members_select[\s\S]{0,200}community_is_group_member\(group_id\)/)                           // member list members-only
  const view = read('src/components/community/GroupView.jsx')
  assert.match(view, /\(member \|\| group\.privacy === 'public'\) && <Feed/, 'the screen never requests private content for non-members')
  const rls = read('supabase/tests/slice1_rls.sql')
  assert.ok(!/A cannot see B''s private group/.test(rls), 'the old contradicting test is gone')
  assert.match(rls, /A can discover B''s private group by name/); assert.match(rls, /A cannot read posts inside B''s private group/)
})

// ---------- C. smart actions ----------
test('009: finish is bound to the live claim and its audit record; old signatures are dropped', () => {
  for (const f of ['notification_begin_action(uuid, text)', 'notification_finish_action(uuid, text, boolean, text)', 'notification_snooze(uuid, text)', 'notification_wake_due()']) assert.ok(code.includes(`drop function if exists public.${f}`), f)
  const fin = code.slice(code.indexOf('function public.notification_finish_action'), code.indexOf('REMIND ME AFTER 5M') > 0 ? code.indexOf('create or replace function public.notification_snooze') : undefined)
  for (const part of [/p_claim uuid/, /raise exception 'no_audit_record'/, /raise exception 'no_active_claim'/, /n\.action_claim_id is distinct from p_claim/, /a\.claim_id is distinct from p_claim/, /a\.outcome <> 'started'/, /for update/]) assert.match(fin, part)
  assert.match(code, /raise exception 'key_reuse'/)
})
test('009: audit table is read-only for users; protected notification columns need the functions', () => {
  assert.match(code, /drop policy if exists notification_actions_insert_own/); assert.match(code, /drop policy if exists notification_actions_update_own/); assert.match(code, /drop policy if exists notification_actions_delete_own/)
  assert.match(code, /revoke all on table public\.notification_actions from authenticated, anon;\s*grant select on table public\.notification_actions to authenticated;/)
  assert.match(code, /current_user in \('authenticated', 'anon'\)/)
  assert.match(code, /\(to_jsonb\(new\) - 'is_read' - 'updated_at'\) is distinct from \(to_jsonb\(old\) - 'is_read' - 'updated_at'\)/)
  assert.match(code, /create trigger notifications_guard before update on public\.notifications/)
})
test('009: every SECURITY DEFINER function pins search_path, never reads user_metadata and is closed to anon', () => {
  const names = code.split('create or replace function public.').slice(1)
    .filter((chunk) => /security definer/.test(chunk.slice(0, chunk.indexOf('$$'))))
    .map((chunk) => { const header = chunk.slice(0, chunk.indexOf('$$')); assert.match(header, /set search_path = public, pg_temp/); return chunk.match(/^(\w+)/)[1] }).sort()
  assert.deepEqual(names, ['community_can_read_media', 'notification_begin_action', 'notification_finish_action', 'notification_snooze', 'notification_wake_due'])
  for (const n of names) assert.match(code, new RegExp(`revoke all on function public\\.${n}\\([^)]*\\) from public, anon`), n)
  assert.ok(!/user_metadata/.test(code))
  // each notification function filters by the caller, because definer functions bypass RLS
  for (const n of ['notification_begin_action', 'notification_finish_action', 'notification_snooze']) {
    const body = code.slice(code.indexOf(`function public.${n}`)); assert.match(body.slice(0, 1800), /user_id = uid/, n)
  }
  assert.match(code.slice(code.indexOf('function public.notification_wake_due')), /user_id = auth\.uid\(\)/)
})
test('client: DO IT finishes with the claim id issued by the server, and refuses to run without one', async () => {
  const calls = []
  const rpc = async (name, a) => {
    calls.push([name, a])
    if (name === 'notification_begin_action') return { claimed: true, claim_id: U2, action_kind: 'open', action_ref: {}, link: '/x' }
    return { status: 'done' }
  }
  const out = await doItCore({ id: U1, link: '/x' }, { rpc, run: {}, today: '2026-10-31' })
  assert.equal(out.status, 'done')
  const fin = calls.find((c) => c[0] === 'notification_finish_action')[1]
  assert.equal(fin.p_claim, U2); assert.equal(fin.p_ok, true); assert.equal(fin.p_notification, U1)
  let ran = false
  const bad = async (name) => (name === 'notification_begin_action' ? { claimed: true, action_kind: 'complete_task', action_ref: { id: U2 } } : { status: 'done' })
  await assert.rejects(doItCore({ id: U1 }, { rpc: bad, run: { complete_task: async () => { ran = true } }, today: 'x' }), /valid claim/)
  assert.equal(ran, false, 'the action must not run without a claim')
})
test('client: a failed action releases the claim with the same claim id, and a rejected finish does not hide the original error', async () => {
  const seen = []
  const rpc = async (name, a) => {
    if (name === 'notification_begin_action') return { claimed: true, claim_id: U2, action_kind: 'complete_reminder', action_ref: { id: U1 } }
    seen.push(a); throw new Error('no_active_claim')
  }
  await assert.rejects(doItCore({ id: U1 }, { rpc, run: { complete_reminder: async () => { throw new Error('boom') } }, today: 'x' }), /boom/)
  assert.equal(seen[0].p_claim, U2); assert.equal(seen[0].p_ok, false)
})
