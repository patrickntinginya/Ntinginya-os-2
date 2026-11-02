// Static review of migration 010 (live chat). No Postgres exists in the build sandbox, so this reads the SQL; the executable proof is
// supabase/tests/chat_rls.sql (run by scripts/verify-db.sh). These checks catch the mistakes that make a chat leak.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const sql = fs.readFileSync(new URL('../supabase/migrations/010_chat.sql', import.meta.url), 'utf8')
const fix = fs.readFileSync(new URL('../supabase/migrations/011_chat_attachment_access.sql', import.meta.url), 'utf8')
const fixCode = fix.replace(/--.*$/gm, '')
const code = sql.replace(/--.*$/gm, '') // comments removed: the words "user_metadata" etc. may appear in explanations
const tables = [...code.matchAll(/create table if not exists public\.(chat_\w+)/g)].map((m) => m[1])
const fns = [...code.matchAll(/create or replace function public\.(chat_\w+)\(([^)]*)\)([\s\S]*?)\$\$;?/g)].map((m) => ({ name: m[1], args: m[2], header: m[0].slice(0, m[0].indexOf('$$')) }))
const policy = (name) => { const i = code.indexOf(`create policy ${name} `); assert.ok(i >= 0, `policy ${name}`); return code.slice(i, code.indexOf(';', i)) }

test('every chat table has row level security, and there is no open policy', () => {
  assert.equal(tables.length, 6)
  for (const t of tables) assert.ok(code.includes(`alter table public.${t} enable row level security`), `${t} RLS`)
  assert.ok(!/using \(true\)|with check \(true\)/i.test(code))
  assert.ok(!/disable row level security/i.test(code))
  assert.ok(!/to (anon|public)\b[^;]*create policy|create policy[^;]*to (anon|public)\b/i.test(code))
})

test('clients can only READ conversations/members and only INSERT messages: no direct update or delete of messages, members or conversations', () => {
  assert.match(code, /revoke all on public\.chat_conversations, public\.chat_members, public\.chat_messages, public\.chat_reports, public\.chat_settings, public\.chat_last_seen from anon, authenticated/)
  assert.match(code, /grant select on public\.chat_conversations, public\.chat_members to authenticated/)
  assert.match(code, /grant select, insert on public\.chat_messages to authenticated/)
  for (const t of ['chat_conversations', 'chat_members', 'chat_messages', 'chat_last_seen']) assert.ok(!new RegExp(`grant[^;]*(update|delete)[^;]*public\\.${t}\\b`).test(code), `${t} has no update/delete grant`)
  assert.ok(!/create policy \w+ on public\.chat_(conversations|members|last_seen) for (insert|update|delete)/.test(code), 'no write policies on membership tables')
  assert.ok(!/create policy chat_messages_(update|delete)/.test(code))
  assert.ok(!/create policy chat_last_seen/.test(code), 'last-seen has no policy: no direct access')
})

test('messages: read needs active membership AND only history since joining AND no block; send needs chat_can_send and the caller as sender', () => {
  const sel = policy('chat_messages_select')
  assert.match(sel, /mem\.left_at is null/); assert.match(sel, /created_at >= mem\.history_from/); assert.match(sel, /community_blocks/)
  const ins = policy('chat_messages_insert')
  assert.match(ins, /sender_id = \(select auth\.uid\(\)\)/); assert.match(ins, /chat_can_send\(conversation_id\)/)
})

test('the server decides time and ignores edit/delete fields sent by a client; media paths must sit under the sender and conversation', () => {
  const trig = code.slice(code.indexOf('function public.chat_messages_before_insert'), code.indexOf('drop trigger if exists chat_messages_before_insert'))
  assert.match(trig, /new\.created_at := now\(\)/); assert.match(trig, /new\.edited_at := null; new\.deleted_at := null/)
  assert.match(trig, /not like new\.sender_id::text \|\| '\/' \|\| new\.conversation_id::text/)
  assert.match(trig, /rate_limited/)
})

test('every chat function pins search_path, and is either granted to signed-in users only, or revoked from clients entirely', () => {
  assert.ok(fns.length >= 25)
  // sliced from the ORIGINAL text, because the section markers are SQL comments
  const granted = sql.slice(sql.indexOf("foreach f in array array[\n    'chat_is_member"), sql.indexOf('-- Internal helpers'))
  const internal = sql.slice(sql.indexOf('-- Internal helpers'), sql.indexOf('-- trigger functions'))
  assert.ok(granted.length > 200 && internal.length > 100, 'sections found')
  for (const f of fns) {
    if (/security definer/.test(f.header)) assert.match(f.header, /set search_path = public/, `${f.name} search_path`)
    const trigger = ['chat_messages_before_insert', 'chat_messages_after_insert'].includes(f.name)
    const sig = `'${f.name}(`
    if (trigger) assert.match(code, new RegExp(`revoke all on function public\\.${f.name}\\(\\) from public, anon, authenticated`), `${f.name} revoked`)
    else assert.ok(granted.includes(sig) || internal.includes(sig), `${f.name} must be listed as granted or internal`)
  }
  assert.match(code, /execute format\('revoke all on function public\.%s from public, anon', f\)/)
  assert.match(code, /grant execute on function public\.%s to authenticated/)
  // helpers that accept ARBITRARY user ids must not be callable by clients
  for (const h of ['chat_blocked_between(uuid,uuid)', 'chat_profile_ok(uuid)', 'chat_accepts_new_chats(uuid)']) assert.ok(internal.includes(`'${h}'`), `${h} internal`)
  assert.ok(!granted.includes("'chat_blocked_between"), 'block lists are not queryable by clients')
})

test('inbox runs with the CALLER\'S rights so row security applies to every count it returns', () => {
  const inbox = fns.find((f) => f.name === 'chat_inbox'); assert.ok(inbox)
  assert.match(inbox.header, /security invoker/); assert.ok(!/security definer/.test(inbox.header))
})

test('blocking: nobody starts or continues a direct chat across a block; group invitations respect blocks and the "allow new chats" choice', () => {
  const start = code.slice(code.indexOf('function public.chat_start_direct'), code.indexOf('function public.chat_create_group'))
  assert.match(start, /chat_blocked_between\(me, p_other\)/); assert.match(start, /chat_accepts_new_chats\(p_other\)/); assert.match(start, /direct_key/)
  const send = code.slice(code.indexOf('function public.chat_can_send'), code.indexOf('-- Storage helpers'))
  assert.match(send, /community_profiles[\s\S]*status = 'suspended'/); assert.match(send, /chat_blocked_between/); assert.match(send, /c\.status = 'active'/)
  for (const f of ['chat_create_group', 'chat_add_members']) { const b = code.slice(code.indexOf(`function public.${f}`)); assert.match(b.slice(0, b.indexOf('end $$')), /chat_blocked_between\(me, u\)/, f) }
})

test('privacy: moderators see only reported messages (a snapshot), never a general view of private chats; admin comes only from app_metadata', () => {
  assert.ok(!/community_is_admin\(\)[^;]*chat_messages|chat_messages[^;]*community_is_admin\(\)/.test(code.replace(/create policy chat_reports[^;]*;/g, '')), 'no admin read policy on chat_messages')
  assert.match(code, /snapshot_body/); assert.match(policy('chat_reports_select'), /reporter_id = \(select auth\.uid\(\)\) or public\.community_is_admin\(\)/)
  assert.ok(!/user_metadata/.test(code))
  const rep = code.slice(code.indexOf('function public.chat_report'), code.indexOf('-- Last seen'))
  assert.match(rep, /left_at is null/); assert.match(rep, /history_from/); assert.match(rep, /own_message/)
})

test('late joiners cannot read earlier history, and leaving removes access', () => {
  assert.match(code, /history_from timestamptz not null default now\(\)/)
  assert.match(code, /joined_at = now\(\), history_from = now\(\), last_read_at = null/)
  assert.match(code, /set left_at = now\(\) where conversation_id = p_conv and user_id = me/)
})

test('private media bucket: not public, readable only by authorised members, writable only into the sender\'s own conversation folder, immutable', () => {
  assert.match(code, /values \('chat-media', 'chat-media', false, 52428800/)
  assert.match(code, /on conflict \(id\) do update set public = false/)
  assert.match(policy('chat_media_select'), /chat_storage_can_read\(name\)/); assert.match(policy('chat_media_insert'), /chat_storage_can_write\(name\)/)
  assert.ok(!/create policy chat_media_update/.test(code)); assert.match(policy('chat_media_delete'), /foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/)
  // The attachment read rule is defined by the LATEST migration (011 replaces the 010 version): see the dedicated tests below.
  assert.match(fixCode, /create or replace function public\.chat_storage_can_read/)
})

test('Realtime: tables are published (guarded), and private typing/presence channels admit members only', () => {
  assert.match(code, /if exists \(select 1 from pg_publication where pubname = 'supabase_realtime'\)/)
  for (const t of ['chat_messages', 'chat_members', 'chat_conversations']) assert.match(code, new RegExp(`add table public\\.${t}`))
  assert.match(code, /create policy chat_realtime_read on realtime\.messages for select to authenticated using \(public\.chat_topic_member\(realtime\.topic\(\)\)\)/)
  assert.match(code, /create policy chat_realtime_write on realtime\.messages for insert to authenticated with check \(public\.chat_topic_member\(realtime\.topic\(\)\)\)/)
})

test('notifications: one resurfacing alert per conversation, skipping the sender, muted members, left members and blocked pairs', () => {
  const t = code.slice(code.indexOf('function public.chat_messages_after_insert'), code.indexOf('drop trigger if exists chat_messages_after_insert'))
  for (const part of ['m.user_id <> new.sender_id', 'm.left_at is null', 'not m.muted', 'chat_blocked_between(new.sender_id, m.user_id)', "'chat:' || new.conversation_id::text", 'on conflict (user_id, dedupe_key) do update']) assert.ok(t.includes(part), part)
})

test('the realtime client uses PRIVATE channels, and supabase-js is new enough for them', () => {
  const rt = fs.readFileSync(new URL('../src/lib/chatRealtime.js', import.meta.url), 'utf8')
  assert.match(rt, /private: true/)
  const v = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).dependencies['@supabase/supabase-js']
  const [maj, min] = v.replace(/[^\d.]/g, '').split('.').map(Number)
  assert.ok(maj > 2 || (maj === 2 && min >= 45), `supabase-js ${v} supports private Realtime channels`)
})

const readFn = () => fixCode.slice(fixCode.indexOf('function public.chat_storage_can_read'), fixCode.indexOf('$$;', fixCode.indexOf('function public.chat_storage_can_read')))

test('SECURITY: attachment reads have NO ownership shortcut (a sender who left, was removed, deleted the message or never sent the file reads nothing)', () => {
  const f = readFn()
  assert.ok(f.length > 300, 'function found')
  // the 010 bug: "split_part(object_name, '/', 1) = auth.uid() OR ..."  Nothing may grant access before the membership/message checks.
  assert.ok(!/auth\.uid\(\)\)::text\)\s*or\b/i.test(f), 'no owner-folder OR branch')
  assert.ok(!/split_part\(object_name, '\/', 1\) = \(select auth\.uid\(\)\)::text/.test(f), 'the folder name is never compared with the caller')
  assert.match(f, /then exists \(/, 'the whole decision is one exists() over messages and memberships')
})

test('SECURITY: an attachment is readable only via an ACTIVE membership, a live message, history_from and the block list', () => {
  const f = readFn()
  for (const [rule, re] of [
    ['active membership', /mem\.user_id = \(select auth\.uid\(\)\) and mem\.left_at is null/],
    ['a message points at exactly this object', /m\.media_path = object_name/],
    ['message not deleted', /m\.deleted_at is null/],
    ['history_from', /m\.created_at >= mem\.history_from/],
    ['blocking', /not exists \(select 1 from public\.community_blocks b where b\.user_id = \(select auth\.uid\(\)\) and b\.blocked_user_id = m\.sender_id\)/],
    ['folder owner must be the message sender', /m\.sender_id::text = split_part\(object_name, '\/', 1\)/],
    ['folder conversation must be the message conversation', /m\.conversation_id::text = split_part\(object_name, '\/', 2\)/],
    ['uuid casts only on well-formed names', /case when object_name ~/],
    ['membership joins the message conversation', /mem\.conversation_id = m\.conversation_id/],
  ]) assert.match(f, re, rule)
})

test('011 keeps the function private: security definer, pinned search_path, still executable only by signed-in users (grants from 010 stay)', () => {
  const header = fixCode.slice(fixCode.indexOf('create or replace function public.chat_storage_can_read'), fixCode.indexOf('$$', fixCode.indexOf('create or replace function public.chat_storage_can_read')))
  assert.match(header, /security definer set search_path = public/)
  assert.ok(!/grant execute/i.test(fixCode), '011 does not widen any grant')
  assert.ok(/chat_storage_can_read\(text\)/.test(sql) && /grant execute on function public\.%s to authenticated/.test(sql))
  assert.ok(!/create policy|drop policy/i.test(fixCode), 'policies are untouched: nothing weakened')
})

test('voice messages are limited by the database: <= 5 minutes, <= 5 MB, audio MIME, duration required', () => {
  assert.match(fixCode, /chat_messages_voice_limits/)
  for (const part of ['duration_ms between 500 and 300000', 'media_size <= 5242880', "media_mime like 'audio/%'", 'duration_ms is not null', 'media_size is not null']) assert.ok(fixCode.includes(part), part)
  assert.match(fixCode, /not valid/)
})
