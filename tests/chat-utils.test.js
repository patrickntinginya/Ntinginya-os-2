import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT, attachmentKind, canEdit, chatError, chatMediaPath, createTypingTracker, lastSeenInfo, mergeMessages, messageStatus, optimisticMessage, typingLabel, validateChatMessage, validateGroup } from '../src/utils/chat.js'

const ME = 'me'; const T0 = Date.parse('2026-10-31T10:00:00Z'); const iso = (ms) => new Date(T0 + ms).toISOString()
const msg = (o = {}) => ({ id: 'm1', sender_id: ME, kind: 'text', body: 'hi', created_at: iso(0), ...o })
const mem = (id, o = {}) => ({ user_id: id, left_at: null, history_from: iso(-10000), last_delivered_at: null, last_read_at: null, ...o })

test('message validation: text, length, attachment type/size', () => {
  assert.equal(validateChatMessage({ body: '   ' }), 'Write a message or attach a file.')
  assert.equal(validateChatMessage({ body: 'hello' }), null)
  assert.ok(validateChatMessage({ body: 'x'.repeat(CHAT.body + 1) }))
  assert.equal(validateChatMessage({ body: '', file: { type: 'image/png', size: 10 } }), null, 'a file alone is fine')
  assert.ok(validateChatMessage({ file: { type: 'application/x-msdownload', size: 10 } }), 'executables are refused')
  assert.ok(validateChatMessage({ file: { type: 'image/png', size: 0 } }))
  assert.ok(validateChatMessage({ file: { type: 'image/png', size: CHAT.media + 1 } }))
  assert.equal(attachmentKind('image/webp'), 'image'); assert.equal(attachmentKind('video/mp4'), 'video'); assert.equal(attachmentKind('application/pdf'), 'file'); assert.equal(attachmentKind('audio/mpeg'), 'file'); assert.equal(attachmentKind('text/html'), null)
})
test('group validation', () => {
  assert.ok(validateGroup({ title: ' ', memberIds: ['a'] })); assert.ok(validateGroup({ title: 'x'.repeat(61), memberIds: ['a'] })); assert.ok(validateGroup({ title: 'Team', memberIds: [] }))
  assert.ok(validateGroup({ title: 'Team', memberIds: Array.from({ length: 50 }, (_, i) => `u${i}`) }), '50 others + me is 51')
  assert.equal(validateGroup({ title: 'Team', memberIds: Array.from({ length: 49 }, (_, i) => `u${i}`) }), null)
  assert.ok(validateGroup({ title: 'Team', memberIds: ['a', 'a'] }) === null, 'duplicates collapse')
})
test('media path has the exact shape the storage policy requires and cannot escape its folder', () => {
  const u = '11111111-1111-4111-8111-111111111111'; const c = '22222222-2222-4222-8222-222222222222'
  const p = chatMediaPath(u, c, 'abc', '../../etc/pass wd.png')
  assert.match(p, new RegExp(`^${u}/${c}/abc-[A-Za-z0-9._-]+$`)); assert.ok(!p.includes('..'), p); assert.equal(p.split('/').length, 3)
})
test('sent / delivered / read for a direct chat', () => {
  const m = msg()
  assert.equal(messageStatus(m, ME, [mem(ME), mem('b')]).status, 'sent')
  assert.equal(messageStatus(m, ME, [mem(ME), mem('b', { last_delivered_at: iso(500) })]).status, 'delivered')
  assert.equal(messageStatus(m, ME, [mem(ME), mem('b', { last_delivered_at: iso(500), last_read_at: iso(900) })]).status, 'read')
  assert.equal(messageStatus(m, ME, [mem(ME), mem('b', { last_read_at: iso(900) })]).status, 'read', 'read implies delivered')
  assert.equal(messageStatus(m, ME, [mem(ME), mem('b', { last_delivered_at: iso(-5) })]).status, 'sent', 'delivered BEFORE the message does not count')
  assert.equal(messageStatus({ ...m, _pending: true }, ME, []).status, 'sending'); assert.equal(messageStatus({ ...m, _failed: true }, ME, []).status, 'failed')
})
test('group status needs EVERYONE: partial delivery stays "sent", late joiners and leavers do not count', () => {
  const m = msg()
  const base = [mem(ME), mem('b', { last_read_at: iso(100) }), mem('c')]
  const s = messageStatus(m, ME, base); assert.equal(s.status, 'sent'); assert.deepEqual([s.readBy, s.total], [1, 2])
  assert.equal(messageStatus(m, ME, [...base.slice(0, 2), mem('c', { last_read_at: iso(200) })]).status, 'read')
  assert.equal(messageStatus(m, ME, [...base.slice(0, 2), mem('c', { left_at: iso(50) })]).status, 'read', 'a member who left is ignored')
  assert.equal(messageStatus(m, ME, [...base.slice(0, 2), mem('c', { history_from: iso(1000) })]).status, 'read', 'someone who joined later never saw it')
})
test('merging: dedupe, order, optimistic copy replaced by the real row, updates applied', () => {
  const opt = optimisticMessage({ id: 'tmp1', clientId: 'cid1', conversationId: 'c', me: ME, body: 'yo', now: iso(10) })
  let list = mergeMessages([], [msg({ id: 'a', created_at: iso(0) }), opt])
  assert.deepEqual(list.map((x) => x.id), ['a', 'tmp1']); assert.equal(list[1]._pending, true)
  list = mergeMessages(list, [msg({ id: 'real1', client_id: 'cid1', body: 'yo', created_at: iso(20) })])
  assert.deepEqual(list.map((x) => x.id), ['a', 'real1']); assert.equal(list[1]._pending, false)
  list = mergeMessages(list, [msg({ id: 'real1', body: 'yo!', edited_at: iso(30), created_at: iso(20) }), msg({ id: 'a', created_at: iso(0) })])
  assert.equal(list.length, 2); assert.equal(list[1].body, 'yo!'); assert.ok(list[1].edited_at)
  const tie = mergeMessages([], [msg({ id: 'b', created_at: iso(5) }), msg({ id: 'a', created_at: iso(5) })]); assert.deepEqual(tie.map((x) => x.id), ['a', 'b'], 'stable order for equal times')
  assert.equal(mergeMessages(list, [msg({ id: 'x', client_id: 'cid1', sender_id: 'other', created_at: iso(40) })]).length, 3, 'another sender with the same client id never replaces mine')
})
test('editing is only for my own live text messages within 24 hours', () => {
  const now = T0 + 1000
  assert.equal(canEdit(msg(), ME, now), true); assert.equal(canEdit(msg({ sender_id: 'x' }), ME, now), false); assert.equal(canEdit(msg({ kind: 'image' }), ME, now), false)
  assert.equal(canEdit(msg({ deleted_at: iso(1) }), ME, now), false); assert.equal(canEdit(msg(), ME, T0 + CHAT.editWindowMs + 1), false); assert.equal(canEdit(msg({ _pending: true }), ME, now), false)
})
test('typing indicators expire on their own', () => {
  let now = 1000; const tr = createTypingTracker({ ttl: 4000, now: () => now })
  tr.heard('a'); tr.heard('b'); assert.deepEqual(tr.active().sort(), ['a', 'b'])
  now += 3000; tr.heard('a'); now += 2000; assert.deepEqual(tr.active(), ['a'], 'b expired, a was refreshed')
  tr.stopped('a'); assert.deepEqual(tr.active(), [])
  assert.equal(typingLabel([]), ''); assert.equal(typingLabel(['Amina']), 'Amina is typing…'); assert.equal(typingLabel(['A', 'B']), 'A and B are typing…'); assert.equal(typingLabel(['A', 'B', 'C']), 'Several people are typing…')
})
test('last seen text', () => {
  assert.deepEqual(lastSeenInfo(null), { key: 'hidden' }); assert.deepEqual(lastSeenInfo(iso(0), T0 + 30000), { key: 'online' })
  assert.deepEqual(lastSeenInfo(iso(0), T0 + 5 * 60000), { key: 'minutes', n: 5 }); assert.deepEqual(lastSeenInfo(iso(0), T0 + 3 * 3600000), { key: 'hours', n: 3 })
  assert.deepEqual(lastSeenInfo(iso(0), T0 + 2 * 86400000), { key: 'days', n: 2 }); assert.deepEqual(lastSeenInfo(iso(0), T0 + 30 * 86400000), { key: 'long' })
})
test('database errors become friendly phrases', () => {
  for (const [raw, part] of [['rate_limited', 'too quickly'], ['blocked', 'cannot message'], ['dm_disabled', 'not accepting'], ['profile_required', 'Join the Community'], ['new row violates row-level security policy', 'not allowed'], ['locked', 'locked'], ['group_full', '50']]) assert.match(chatError({ message: raw }), new RegExp(part))
  assert.equal(chatError({ message: 'weird' }), null)
})
