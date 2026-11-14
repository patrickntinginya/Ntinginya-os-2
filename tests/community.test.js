// Slice 1b: Community. SQL is checked statically (no Postgres here); pure rules and the client flow are executed.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  LIMITS, REACTIONS, REPORT_REASONS, applyReaction, clean, communityError, initials, isAdminUser, mediaKindOf, mediaPath, searchPattern, threadComments, timeAgo,
  validateComment, validateGroup, validatePost, validateProfile,
} from '../src/utils/community.js'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const sql = read('supabase/migrations/007_community.sql')
const commentUpdateSql = read('supabase/migrations/014_community_comment_update_guard.sql')
const U = '11111111-1111-4111-8111-111111111111'

// ---------- navigation ----------
// navigation.js imports the lucide-react icon library, which a plain `node --test` run must not need. The structure is read from the source text instead,
// so this file loads and runs whether or not node_modules is installed.
const navSrc = read('src/lib/navigation.js')
const listOf = (name) => { const m = navSrc.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\n\\]`)); assert.ok(m, `${name} found`); return [...m[1].matchAll(/\{ to: '([^']+)'[^}]*?icon: (\w+)/g)].map((x) => ({ to: x[1], icon: x[2] })) }
const NAV_ITEMS = listOf('NAV_ITEMS'); const SECONDARY_ITEMS = listOf('SECONDARY_ITEMS'); const ALL_ITEMS = [...NAV_ITEMS, ...SECONDARY_ITEMS]
const BOTTOM_NAV_PATHS = [...navSrc.match(/BOTTOM_NAV_PATHS = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
test('Community is a MAIN item: in the sidebar list and the mobile bottom bar, never only in More', () => {
  assert.ok(NAV_ITEMS.some((i) => i.to === '/community'), 'primary navigation')
  assert.ok(!SECONDARY_ITEMS.some((i) => i.to === '/community'), 'not a secondary (More-only) item')
  assert.ok(BOTTOM_NAV_PATHS.includes('/community'), 'bottom bar')
  assert.ok(BOTTOM_NAV_PATHS.includes('/ai'), 'AI stays in the bottom bar')
  assert.ok(BOTTOM_NAV_PATHS.length <= 5)
  assert.ok(ALL_ITEMS.find((i) => i.to === '/community').icon, 'has its own icon')
  const layout = read('src/layouts/AppLayout.jsx')
  assert.match(layout, /\['\/dashboard', '\/insights', '\/ai', '\/settings'\]\.map/)
  assert.match(layout, /min-w-0 flex-1/, 'six bottom-bar columns shrink instead of overflowing small phones')
  assert.match(layout, /truncate/)
  assert.match(read('src/App.jsx'), /path="\/community" element=\{<Community \/>\}/)
  assert.equal(read('src/i18n/en.js').includes("'nav.community': 'Community'"), true)
  assert.equal(read('src/i18n/sw.js').includes("'nav.community': 'Jamii'"), true)
})

test('the Community screen implements the real features, not a placeholder', () => {
  const files = ['Feed', 'Composer', 'Comments', 'PostCard', 'GroupsPanel', 'GroupView', 'MePanel', 'ModerationPanel', 'ReportDialog'].map((f) => read(`src/components/community/${f}.jsx`)).join('\n') + read('src/pages/Community.jsx')
  for (const needle of [/createPost/, /<video/, /<img/, /addComment/, /parentId/, /REACTIONS/, /fetchGroups/, /createGroup/, /joinGroup/, /decideJoinRequest/, /trending/, /type="search"/, /reportTarget/, /blockUser/, /unblockUser/, /moderate\(/, /show_bio/, /allow_comments|allowComments/]) assert.match(files, needle, String(needle))
  assert.ok(!/TODO|coming soon|placeholder page/i.test(files))
  assert.match(read('src/services/community.js'), /from\('community_feed'\)/)
})

// ---------- pure rules ----------
test('post, comment, profile and group validation', () => {
  assert.ok(validatePost({ body: '   ' }))
  assert.equal(validatePost({ body: 'Hello' }), null)
  assert.ok(validatePost({ body: 'x'.repeat(LIMITS.post + 1) }))
  assert.equal(validatePost({ body: '', file: { type: 'image/png', size: 100 } }), null)
  assert.ok(validatePost({ body: 'a', file: { type: 'application/x-msdownload', size: 100 } }), 'executables refused')
  assert.ok(validatePost({ body: 'a', file: { type: 'video/mp4', size: LIMITS.media + 1 } }), '50 MB cap')
  assert.ok(validatePost({ body: 'a', file: { type: 'video/mp4', size: 0 } }))
  assert.ok(validateComment(' ') && validateComment('x'.repeat(1001)) && !validateComment('ok'))
  assert.ok(validateProfile({ display_name: 'A' }) && validateProfile({ display_name: 'Asha', bio: 'x'.repeat(301) }) && !validateProfile({ display_name: 'Asha' }))
  assert.ok(validateGroup({ name: 'ab' }) && !validateGroup({ name: 'Study group' }))
  assert.equal(clean('  a\u0000b\r\nc '), 'ab\nc')
})

test('limits in the code match the limits in the database', () => {
  assert.match(sql, /char_length\(body\) <= 2000/)
  assert.match(sql, /char_length\(btrim\(body\)\) between 1 and 1000/)
  assert.match(sql, /char_length\(btrim\(display_name\)\) between 2 and 40/)
  assert.match(sql, /char_length\(bio\) <= 300/)
  assert.match(sql, /file_size_limit[\s\S]*52428800/)
  assert.equal(LIMITS.media, 52428800)
  for (const r of REPORT_REASONS) assert.ok(sql.includes(`'${r.value}'`), r.value)
  for (const r of REACTIONS) assert.ok(sql.includes(`'${r.kind}'`), r.kind)
})

test('upload paths always start with the uploader id (what the storage policy requires)', () => {
  assert.equal(mediaPath(U, 'image/png', 'abc'), `${U}/abc.png`)
  assert.equal(mediaPath(U, 'video/mp4', 'abc'), `${U}/abc.mp4`)
  assert.throws(() => mediaPath(U, 'text/html', 'abc'))
  assert.deepEqual([mediaKindOf('image/webp'), mediaKindOf('video/webm'), mediaKindOf('audio/mpeg')], ['image', 'video', null])
})

test('comments are threaded one level; reactions update counters without double counting', () => {
  const t = threadComments([{ id: 'a' }, { id: 'b', parent_id: 'a' }, { id: 'c' }, { id: 'd', parent_id: 'a' }])
  assert.deepEqual(t.map((c) => [c.id, c.replies.map((r) => r.id)]), [['a', ['b', 'd']], ['c', []]])
  const p = { reaction_count: 2, my_reaction: null }
  const liked = applyReaction(p, 'like'); assert.deepEqual([liked.reaction_count, liked.my_reaction], [3, 'like'])
  const changed = applyReaction(liked, 'love'); assert.equal(changed.reaction_count, 3)
  const removed = applyReaction(changed, null); assert.deepEqual([removed.reaction_count, removed.my_reaction], [2, null])
  assert.equal(applyReaction({ reaction_count: 0, my_reaction: null }, null).reaction_count, 0)
})

test('search text cannot inject PostgREST filter syntax; helpers behave', () => {
  assert.equal(searchPattern('hello),user_id.eq.x'), '%hello user id eq x%') // commas, dots, parens and LIKE wildcards (% _) are all neutralised
  assert.equal(searchPattern('%%%'), '')
  assert.equal(initials('asha mwangi'), 'AM'); assert.equal(initials(''), '?')
  assert.equal(timeAgo('2026-10-30T10:00:00Z', Date.parse('2026-10-30T10:00:30Z')), 'now')
  assert.equal(timeAgo('2026-10-30T10:00:00Z', Date.parse('2026-10-30T12:00:00Z')), '2h')
  assert.equal(isAdminUser({ app_metadata: { role: 'admin' } }), true)
  assert.equal(isAdminUser({ user_metadata: { role: 'admin' } }), false, 'user_metadata is user-editable and never trusted')
  assert.match(communityError(new Error('rate_limited')), /too quickly/)
  assert.match(communityError({ message: 'new row violates row-level security policy' }), /permission/)
  assert.equal(communityError(new Error('boom')), null)
})

// ---------- migration 007 (static checks; NOT executed against Postgres) ----------
test('every community table has RLS enabled; none is open to anon; no always-true policy', () => {
  const tables = [...sql.matchAll(/create table if not exists public\.(community_\w+)/g)].map((m) => m[1])
  assert.equal(tables.length, 9)
  const loop = sql.match(/foreach t in array array\[([^\]]+)\]/)[1]
  for (const t of tables) assert.ok(loop.includes(`'${t}'`), `${t} in the RLS loop`)
  assert.match(sql, /alter table public\.%I enable row level security/)
  assert.ok(!/using \(true\)|with check \(true\)|disable row level security/i.test(sql))
  assert.match(sql, /revoke all on public\.community_profiles[\s\S]*from anon/)
  assert.ok(!/drop table|truncate/i.test(sql))
  for (const t of tables) assert.ok(new RegExp(`create policy ${t}_select`).test(sql), `${t} has a select policy`)
})

test('users cannot grant themselves moderation powers: status changes are admin-only, admin comes from app_metadata only', () => {
  assert.match(sql, /app_metadata' ->> 'role'/)
  assert.ok(!/user_metadata/.test(sql.replace(/--.*$/gm, '')), 'no executable SQL reads user_metadata (comments excluded)')
  assert.match(sql, /raise exception 'moderation_only'/)
  for (const t of ['community_profiles', 'community_posts', 'community_comments', 'community_groups', 'community_reports']) assert.match(sql, new RegExp(`create trigger ${t}_guard before update on public\\.${t}`))
  assert.match(sql, /community_reports_update[\s\S]*using \(public\.community_is_admin\(\)\)/)
  assert.match(sql, /community_moderation_log_select[\s\S]*using \(public\.community_is_admin\(\)\)/)
  assert.match(sql, /community_moderation_log_insert[\s\S]*user_id = \(select auth\.uid\(\)\)/)
  assert.match(sql, /community_profiles_insert[\s\S]*status = 'active'/)
})

test('abuse controls: rate limits, suspension blocks posting, blocks are respected, reports are one-per-target', () => {
  for (const [t, n] of [['community_posts', 20], ['community_comments', 60], ['community_reactions', 300], ['community_reports', 20]]) { assert.match(sql, new RegExp(`create trigger ${t}_rate before insert`)); assert.ok(sql.includes(`>= ${n}`), `${t} limit ${n}`) }
  assert.match(sql, /community_posts_insert[\s\S]*community_can_post\(\)/)
  assert.match(sql, /community_comments_insert[\s\S]*community_can_post\(\)/)
  assert.match(sql, /community_posts_select[\s\S]*not public\.community_blocked\(user_id\)/)
  assert.match(sql, /create unique index if not exists community_reports_once_post/)
  assert.match(sql, /check \(user_id <> blocked_user_id\)/)
  assert.match(sql, /check \(\(post_id is null\) <> \(comment_id is null\)\)/)
  assert.match(sql, /foreign key \(parent_id, post_id\)/, 'a reply must belong to the same post')
  assert.match(sql, /comments_closed/)
})

test('private groups: content only for active members; join requests need approval; only owners/moderators decide', () => {
  assert.match(sql, /g\.privacy = 'public'[\s\S]*community_is_group_member\(group_id\)|community_is_group_member\(group_id\)[\s\S]*g\.privacy = 'public'/)
  assert.match(sql, /role = 'member' and status = 'pending' and exists \(select 1 from public\.community_groups g where g\.id = group_id and g\.privacy = 'private'/)
  assert.match(sql, /community_group_members_update[\s\S]*community_is_group_mod\(group_id\)/)
  assert.match(sql, /community_posts_insert[\s\S]*community_is_group_member\(group_id\)/)
})

test('comment updates cannot move a comment onto a hidden, closed, or unreadable post', () => {
  assert.match(commentUpdateSql, /community_comments_retarget[\s\S]*before update of post_id on public\.community_comments/)
  assert.match(commentUpdateSql, /security invoker set search_path = public/)
  assert.match(commentUpdateSql, /community_can_post\(\)/)
  assert.match(commentUpdateSql, /p\.allow_comments and p\.status = 'visible'/)
  assert.match(commentUpdateSql, /if target_accepts_comments is distinct from true then raise exception 'comments_closed'/)
})

test('SECURITY DEFINER is limited to small yes/no helpers and the notifier, each with a pinned search_path and no anon access', () => {
  const defs = [...sql.matchAll(/create or replace function public\.(\w+)\([^)]*\)\s*returns[^$]*?security definer set search_path = public/g)].map((m) => m[1]).sort()
  assert.deepEqual(defs, ['community_blocked', 'community_can_post', 'community_is_group_member', 'community_is_group_mod', 'community_notify'])
  for (const f of ['community_blocked(uuid)', 'community_is_group_member(uuid)', 'community_is_group_mod(uuid)', 'community_can_post()']) assert.ok(sql.includes(`revoke all on function public.${f} from public, anon`))
  assert.match(sql, /where \(b\.user_id = auth\.uid\(\) and b\.blocked_user_id = other\)/, 'blocked() only answers about the caller')
})

test('media bucket is private, size/type limited, and users can write only inside their own folder', () => {
  assert.match(sql, /'community-media', 'community-media', false, 52428800/)
  assert.match(sql, /community_media_insert[\s\S]*\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/)
  assert.match(sql, /community_media_delete[\s\S]*community_is_admin\(\)/)
  assert.ok(!/'text\/html'|'image\/svg\+xml'/.test(sql), 'no scriptable media types')
})

test('community feed views run with the caller rights so RLS still filters hidden/blocked/private content', () => {
  assert.equal([...sql.matchAll(/with \(security_invoker = true\)/g)].length, 2)
  assert.match(sql, /grant select on public\.community_feed, public\.community_groups_view to authenticated/)
})

test('community content creates notifications for the post owner (actionable: opens the post)', () => {
  assert.match(sql, /insert into public\.notifications[\s\S]*'community'[\s\S]*'open'/)
  assert.match(sql, /on conflict \(user_id, dedupe_key\) do nothing/)
  assert.match(sql, /owner_id = new\.user_id then return new/, 'no notification for your own actions')
})
