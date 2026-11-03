// Static review of migrations 011 (voice limits), 012 (cleanup view) and 013 (voice posts/comments). No Postgres in the build sandbox:
// these read the SQL; supabase/tests/chat_rls.sql is the executable proof. They also keep the JavaScript limits and the SQL limits identical.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { VOICE } from '../src/lib/voiceFormat.js'

const read = (f) => fs.readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')
const strip = (s) => s.replace(/--.*$/gm, '')
const m011 = strip(read('011_chat_attachment_access.sql')); const m012 = strip(read('012_chat_media_cleanup.sql')); const m013 = strip(read('013_voice.sql'))
const m015 = strip(read('015_database_trigger_guards.sql'))

test('JavaScript voice limits and database limits are the same numbers (5 minutes, 5 MB, at least 0.5 s)', () => {
  assert.equal(VOICE.maxMs, 300000); assert.equal(VOICE.maxBytes, 5242880); assert.equal(VOICE.minMs, 500)
  for (const [name, sql] of [['011 chat', m011], ['013 posts/comments', m013]]) {
    assert.match(sql, /between 500 and 300000/, `${name}: duration`)
    assert.match(sql, /5242880/, `${name}: size`)
  }
  assert.match(m013, /5242880[\s\S]*voice_object_within_limits|voice_object_within_limits[\s\S]*5242880/, 'the REAL stored size is checked too')
})

test('011: the voice limits are a constraint, so a modified client cannot skip them', () => {
  assert.match(m011, /add constraint chat_messages_voice_limits check \(\s*kind <> 'voice'/)
  for (const part of ['duration_ms is not null', 'media_size is not null', "media_mime like 'audio/%'"]) assert.ok(m011.includes(part), part)
})

test('012: the list of unattached files is visible to the service role only (never the app)', () => {
  assert.match(m012, /create or replace view public\.chat_media_unattached/)
  assert.match(m012, /revoke all on public\.chat_media_unattached from public, anon, authenticated/)
  assert.match(m012, /grant select on public\.chat_media_unattached to service_role/)
  assert.match(m012, /not exists \(select 1 from public\.chat_messages m where m\.media_path = o\.name\)/)
  assert.match(m012, /interval '1 hour'/, 'the margin keeps it away from an upload whose message is still being inserted')
  const job = fs.readFileSync(new URL('../scripts/cleanup-chat-media.mjs', import.meta.url), 'utf8')
  assert.match(job, /SUPABASE_SERVICE_ROLE_KEY/); assert.match(job, /--delete/); assert.match(job, /Dry run/, 'it lists first and only deletes with --delete')
  assert.ok(!fs.readdirSync(new URL('../src', import.meta.url), { recursive: true }).some((f) => /\.jsx?$/.test(f) && fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').includes('SERVICE_ROLE')), 'the service key never appears in app code')
})

test('013: posts and comments accept voice with the same limits, the comment may have no text, the feed keeps its columns', () => {
  assert.match(m013, /media_kind in \('image','video','voice'\)/)
  assert.match(m013, /add constraint community_posts_voice_limits check \(\s*media_kind is distinct from 'voice'/)
  assert.match(m013, /add constraint community_comments_voice_limits check \(\s*media_kind is null/)
  assert.match(m013, /char_length\(btrim\(body\)\) >= 1 or media_path is not null/)
  assert.match(m013, /split_part\(media_path, '\/', 1\) = user_id::text/, 'a comment file lives in its author\'s folder')
  assert.match(m013, /p\.id, p\.user_id, p\.group_id, p\.body, p\.media_kind, p\.media_path, p\.media_mime, p\.allow_comments, p\.status, p\.created_at,/, 'the first feed columns are unchanged (CREATE OR REPLACE VIEW needs that)')
  assert.match(m013, /security_invoker = true/)
  assert.match(m013, /p\.duration_ms\s*from public\.community_posts p/, 'the new column is appended at the END')
})

test('013: comment voice is readable only under the same rules as the comment and its post', () => {
  const fn = m013.slice(m013.indexOf('function public.community_can_read_media'), m013.indexOf('revoke all on function public.community_can_read_media'))
  for (const part of ["c.media_path = obj_name", "c.status = 'visible'", 'not public.community_blocked(c.user_id)', "p.status = 'visible'", 'public.community_is_group_member(p.group_id)', "g.privacy = 'public'", 'public.community_is_admin()']) assert.ok(fn.includes(part), part)
  assert.match(m013, /revoke all on function public\.community_can_read_media\(text\) from public, anon/)
  assert.ok(!/user_metadata/.test(m013))
})

test('013: the stored size/type of a voice upload is checked by a trigger on all three tables; helpers are not callable by clients', () => {
  for (const t of ['chat_messages_voice_upload on public.chat_messages', 'community_posts_voice_upload on public.community_posts', 'community_comments_voice_upload on public.community_comments']) assert.ok(m013.includes(t), t)
  assert.equal((m013.match(/before insert on public\.(chat_messages|community_posts|community_comments)/g) || []).length, 3)
  for (const f of ['voice_object_within_limits(text, text)', 'voice_upload_guard()']) assert.match(m013, new RegExp(`revoke all on function public\\.${f.replace(/[()]/g, '\\$&')} from public, anon, authenticated`))
  for (const f of ['voice_object_within_limits', 'voice_upload_guard']) assert.match(m013.slice(m013.indexOf(`function public.${f}`)), /set search_path = public/)
  assert.match(m013, /'audio\/webm','audio\/ogg','audio\/mp4','audio\/aac'/, 'the bucket accepts the containers the recorder produces')
})

test('015: voice trigger uses table-specific fields and requires owned paths and real stored audio objects within limits', () => {
  const guard = m015.slice(m015.indexOf('function public.voice_upload_guard'))
  assert.match(guard, /if tg_table_name = 'chat_messages' then[\s\S]*new\.kind[\s\S]*elsif tg_table_name = 'community_posts' or tg_table_name = 'community_comments' then[\s\S]*new\.media_kind/)
  assert.match(guard, /new\.sender_id is distinct from auth\.uid\(\)/)
  assert.match(guard, /new\.user_id is distinct from auth\.uid\(\)/)
  assert.match(guard, /new\.media_path not like new\.sender_id::text \|\| '\/' \|\| new\.conversation_id::text \|\| '\/%'/)
  assert.match(guard, /new\.media_path not like new\.user_id::text \|\| '\/%'/)
  assert.match(guard, /new\.media_mime not like 'audio\/%'/)
  const helper = m015.slice(m015.indexOf('function public.voice_object_within_limits'), m015.indexOf('revoke all on function public.voice_object_within_limits'))
  assert.match(helper, /if not found or object_size is null or object_mime is null then return false/)
  assert.match(helper, /object_mime not like 'audio\/%'/)
  assert.match(helper, /parsed_size between 1 and 5242880/)
})

test('the recorder only produces containers the buckets accept', () => {
  const chatBucket = strip(read('010_chat.sql'))
  for (const base of ['audio/webm', 'audio/ogg', 'audio/mp4']) assert.ok(chatBucket.includes(`'${base}'`), `chat bucket accepts ${base}`)
  assert.ok(m013.includes("'audio/aac'") || chatBucket.includes("'audio/aac'"))
})
