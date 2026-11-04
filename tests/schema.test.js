// Guards the database design: every user-owned table has user_id, RLS and the four owner-only policies.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { USER_TABLES } from '../src/lib/tables.js'

const dir = new URL('../supabase/migrations/', import.meta.url)
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
const sql = files.map((f) => fs.readFileSync(new URL(f, dir), 'utf8')).join('\n')

const created = [...sql.matchAll(/create table if not exists public\.(\w+)\s*\(([\s\S]*?)\n\);/g)].map((m) => ({ name: m[1], body: m[2] }))
const rlsLists = [...sql.matchAll(/foreach t in array array\[([^\]]+)\]/g)].map((m) => [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]))
const rlsTables = new Set(rlsLists.flat())

test('migrations are numbered and additive', () => {
  assert.deepEqual(files.slice(0, 3), ['001_v1_foundation.sql', '002_v2.sql', '003_v3.sql'])
  const versions = files.map((name) => name.match(/^(\d+)_/)?.[1])
  assert.equal(new Set(versions).size, versions.length, 'migration version prefixes must be unique')
  assert.ok(!/drop table/i.test(sql), 'no migration may drop a table')
  assert.ok(!/truncate /i.test(sql), 'no migration may truncate data')
})
test('every created table is a known user table and vice versa (export covers everything)', () => {
  assert.deepEqual(
    created.map((c) => c.name).filter((name) => !['safe_mode_media', 'ai_usage_limits', 'marketplace_professionals', 'marketplace_services', 'marketplace_appointments'].includes(name) && !name.startsWith('community_') && !name.startsWith('chat_')).sort(),
    [...USER_TABLES].sort()
  )
  assert.ok(created.some((c) => c.name === 'safe_mode_media'), 'Safe Mode media table must exist')
  assert.match(sql, /alter table public\.safe_mode_media enable row level security/)
  assert.match(sql, /create policy safe_mode_media_select/)
  assert.match(sql, /create policy safe_mode_media_insert/)
  assert.match(sql, /create policy safe_mode_media_update/)
  assert.match(sql, /create policy safe_mode_media_delete/)
})
test('Marketplace tables are additive, private by RLS, and have dedicated regression coverage', () => {
  const migration = fs.readFileSync(new URL('017_professionals_marketplace.sql', dir), 'utf8')
  assert.match(migration, /create table if not exists public\.marketplace_professionals/)
  assert.match(migration, /create table if not exists public\.marketplace_services/)
  assert.match(migration, /create table if not exists public\.marketplace_appointments/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /public\.community_is_admin\(\)/)
  assert.match(migration, /professional_self_approval/)
  assert.match(migration, /appointment_time_conflict/)
  assert.match(migration, /notifications_type_check[\s\S]*'weekly_review'[\s\S]*'community'[\s\S]*'appointment'[\s\S]*'security'/)
  assert.match(fs.readFileSync(new URL('../supabase/tests/marketplace_rls.sql', import.meta.url), 'utf8'), /marketplace_rls: 0 failures/)
})
test('Marketplace appointment references prevent professional deletion from cascading into history', () => {
  const migration = fs.readFileSync(new URL('018_marketplace_appointment_retention.sql', dir), 'utf8')
  const marketplaceTests = fs.readFileSync(new URL('../supabase/tests/marketplace_rls.sql', import.meta.url), 'utf8')
  assert.match(migration, /foreign key \(professional_id\)[\s\S]*references public\.marketplace_professionals\(user_id\)[\s\S]*on delete restrict/)
  assert.match(marketplaceTests, /professional account deletion is blocked while appointments reference the profile/)
  assert.match(marketplaceTests, /both clients'' appointment histories remain intact after deletion is blocked/)
})
test('AI usage limiter storage is private and its RPC is caller-scoped', () => {
  assert.match(sql, /alter table public\.ai_usage_limits enable row level security/)
  assert.match(sql, /add column if not exists burst_request_times timestamptz\[\]/)
  assert.match(sql, /revoke all on public\.ai_usage_limits from public, anon, authenticated/)
  assert.match(sql, /create schema if not exists private/)
  assert.match(sql, /caller uuid := auth\.uid\(\)/)
  assert.match(sql, /if caller is null then raise exception/)
  assert.match(sql, /set request_times = case when p_enforce_daily then recent_daily \|\| now\(\) else recent_daily end/)
  assert.match(sql, /revoke all on function private\.consume_ai_request\(boolean, integer\) from public, anon, authenticated/)
  assert.match(sql, /grant execute on function public\.consume_ai_request\(\) to authenticated/)
  assert.match(sql, /grant execute on function public\.consume_ai_ping\(\) to authenticated/)
  assert.match(sql, /revoke all on function public\.consume_ai_ping\(\) from public, anon, authenticated/)
  assert.match(sql, /grant execute on function public\.consume_ai_safe_mode_support\(\) to authenticated/)
  assert.match(sql, /revoke all on function public\.consume_ai_safe_mode_support\(\) from public, anon, authenticated/)
})
test('every user-owned table has an owner column that defaults to the signed-in user (chat_* tables are membership-based and are guarded by tests/chat-db.test.js instead)', () => {
  for (const t of created.filter((c) => !c.name.startsWith('chat_'))) {
    assert.match(t.body, /user_id uuid (primary key|not null) default auth\.uid\(\)|user_id uuid primary key references/, `${t.name} needs user_id`)
    assert.match(t.body, /references auth\.users\(id\) on delete cascade/, `${t.name}.user_id must cascade on user deletion`)
  }
})
test('RLS is enabled with owner-only policies on every table', () => {
  for (const t of USER_TABLES) assert.ok(rlsTables.has(t), `${t} is missing from the RLS loop`)
  assert.match(sql, /create policy "%s_select_own"[^;]*to authenticated using \(user_id = \(select auth\.uid\(\)\)\)/)
  assert.match(sql, /create policy "%s_insert_own"[^;]*with check \(user_id = \(select auth\.uid\(\)\)\)/)
  assert.match(sql, /create policy "%s_update_own"[^;]*using \(user_id = \(select auth\.uid\(\)\)\) with check \(user_id = \(select auth\.uid\(\)\)\)/)
  assert.match(sql, /create policy "%s_delete_own"[^;]*using \(user_id = \(select auth\.uid\(\)\)\)/)
})
test('RLS is never disabled and no policy is open to everyone', () => {
  assert.ok(!/disable row level security/i.test(sql))
  assert.ok(!/using \(true\)/i.test(sql))
  assert.ok(!/with check \(true\)/i.test(sql))
  assert.ok(!/to (public|anon)\b[^;]*create policy/i.test(sql))
  assert.match(sql, /revoke all on all tables in schema public from anon/)
})
test('links to other records are ownership-checked by a trigger', () => {
  for (const [child, col] of [['tasks', 'goal_id'], ['tasks', 'project_id'], ['habit_entries', 'habit_id'], ['habits', 'goal_id'], ['projects', 'source_idea_id'], ['ai_messages', 'conversation_id'], ['milestones', 'goal_id']]) {
    assert.match(sql, new RegExp(`\\('${child}','\\w+','${col}'\\)`), `${child}.${col} needs enforce_owner_link`)
  }
})
test('security-definer functions are limited to the caller and not callable by anon', () => {
  assert.match(sql, /delete from auth\.users where id = auth\.uid\(\)/)
  assert.match(sql, /revoke all on function public\.delete_my_account\(\) from public, anon/)
  for (const chunk of sql.split('create or replace function public.').slice(1)) {
    const name = chunk.match(/^(\w+)/)[1]
    const header = chunk.slice(0, chunk.indexOf('$$'))
    if (/security definer/.test(header) && (name.startsWith('chat_') || name.startsWith('voice_'))) assert.match(header, /set search_path = public/, `${name} must pin its search_path (its grants are checked in tests/chat-db.test.js and tests/voice-db.test.js)`)
    else if (/security definer/.test(header)) assert.ok(['handle_new_user', 'delete_my_account', 'community_blocked', 'community_is_group_member', 'community_is_group_mod', 'community_can_post', 'community_notify', 'community_is_group_owner', 'community_can_read_media', 'notification_begin_action', 'notification_finish_action', 'notification_snooze', 'notification_wake_due', 'consume_ai_request', 'consume_ai_ping', 'consume_ai_safe_mode_support', 'marketplace_notify_appointment'].includes(name), `unexpected security definer function ${name}`)
  }
})
test('habits: one entry per habit per day, and frequent queries are indexed', () => {
  assert.match(sql, /unique \(habit_id, entry_date\)/)
  assert.match(sql, /habit_entries_user_date_idx/)
  assert.match(sql, /habits_user_idx/)
})
test('currency defaults to TZS and money is numeric, never text', () => {
  assert.match(sql, /alter column currency set default 'TZS'/)
  assert.ok(!/amount (text|money|float|real)/i.test(sql))
  assert.match(sql, /amount numeric\(14,2\)/)
})
