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
  assert.ok(!/drop table/i.test(sql), 'no migration may drop a table')
  assert.ok(!/truncate /i.test(sql), 'no migration may truncate data')
})
test('every created table is a known user table and vice versa (export covers everything)', () => {
  assert.deepEqual(created.map((c) => c.name).sort(), [...USER_TABLES].sort())
})
test('every user-owned table has an owner column that defaults to the signed-in user', () => {
  for (const t of created) {
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
    if (/security definer/.test(header)) assert.ok(['handle_new_user', 'delete_my_account'].includes(name), `unexpected security definer function ${name}`)
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
