import assert from 'node:assert/strict'
import test from 'node:test'
import { openConversationChannel, openInboxChannel } from '../src/lib/chatRealtime.js'

function fakeClient() {
  const c = { channels: [], removed: [] }
  c.channel = (name, opts) => {
    const ch = { name, opts, handlers: [], sent: [], tracked: [], onsub: null, state: {} }
    ch.on = (type, filter, cb) => { ch.handlers.push({ type, filter, cb }); return ch }
    ch.subscribe = (cb) => { ch.onsub = cb; return ch }
    ch.send = (m) => { ch.sent.push(m) }
    ch.track = async (p) => { ch.tracked.push(p) }
    ch.presenceState = () => ch.state
    c.channels.push(ch); return ch
  }
  c.removeChannel = (ch) => { c.removed.push(ch.name) }
  return c
}
const fire = (ch, type, match, payload) => ch.handlers.filter((h) => h.type === type && (!match || JSON.stringify(h.filter).includes(match))).forEach((h) => h.cb(payload))

test('the conversation channel is private, scoped to this conversation, and tracks presence once subscribed', async () => {
  const c = fakeClient(); const seen = []
  openConversationChannel(c, { conversationId: 'cv1', me: 'me', onStatus: (s) => seen.push(s) })
  const ch = c.channels[0]
  assert.equal(ch.name, 'chat:cv1'); assert.equal(ch.opts.config.private, true); assert.equal(ch.opts.config.presence.key, 'me')
  for (const h of ch.handlers.filter((x) => x.type === 'postgres_changes')) assert.equal(h.filter.filter, 'conversation_id=eq.cv1', 'every row subscription is filtered to the conversation')
  await ch.onsub('SUBSCRIBED'); assert.equal(ch.tracked.length, 1); assert.deepEqual(seen, ['SUBSCRIBED'])
  await ch.onsub('CHANNEL_ERROR'); assert.equal(ch.tracked.length, 1, 'no presence when not subscribed')
})
test('incoming rows, updates, member marks, typing and presence reach the right callbacks; own typing echo is ignored', () => {
  const c = fakeClient(); const got = { msg: [], upd: [], mem: [], typ: [], pres: [] }
  openConversationChannel(c, { conversationId: 'cv1', me: 'me', onMessage: (m) => got.msg.push(m.id), onMessageUpdate: (m) => got.upd.push(m.id), onMembers: (m) => got.mem.push(m.user_id), onTyping: (u, t) => got.typ.push([u, t]), onPresence: (k) => got.pres.push(k) })
  const ch = c.channels[0]
  fire(ch, 'postgres_changes', '"INSERT"', { new: { id: 'm1' } }); fire(ch, 'postgres_changes', '"UPDATE"', { new: { id: 'm1' } }); fire(ch, 'postgres_changes', '"*"', { new: { user_id: 'b' } })
  fire(ch, 'postgres_changes', '"INSERT"', {}); // malformed payloads are ignored
  fire(ch, 'broadcast', null, { payload: { user_id: 'b', typing: true } }); fire(ch, 'broadcast', null, { payload: { user_id: 'me', typing: true } }); fire(ch, 'broadcast', null, { payload: { user_id: 'b', typing: false } }); fire(ch, 'broadcast', null, {})
  ch.state = { b: [{}], me: [{}] }; fire(ch, 'presence', null)
  assert.deepEqual(got, { msg: ['m1'], upd: ['m1'], mem: ['b'], typ: [['b', true], ['b', false]], pres: [['b', 'me']] })
})
test('typing is throttled while typing, sent immediately when stopping, and the channel closes cleanly', () => {
  const c = fakeClient(); const h = openConversationChannel(c, { conversationId: 'cv1', me: 'me' }); const ch = c.channels[0]
  assert.equal(h.sendTyping(true, 10000), true); assert.equal(h.sendTyping(true, 11000), false, 'too soon'); assert.equal(h.sendTyping(true, 12600), true)
  assert.equal(h.sendTyping(false, 12700), true); assert.equal(h.sendTyping(true, 12800), true, 'after stopping, typing starts again at once')
  assert.deepEqual(ch.sent.map((s) => s.payload.typing), [true, true, false, true]); assert.ok(ch.sent.every((s) => s.type === 'broadcast' && s.event === 'typing' && s.payload.user_id === 'me'))
  h.close(); assert.deepEqual(c.removed, ['chat:cv1'])
})
test('the inbox channel listens only to MY membership rows and conversation changes', () => {
  const c = fakeClient(); let n = 0; const h = openInboxChannel(c, { me: 'me', onChange: () => { n += 1 } }); const ch = c.channels[0]
  assert.equal(ch.name, 'inbox:me'); assert.ok(ch.handlers.some((x) => x.filter.table === 'chat_members' && x.filter.filter === 'user_id=eq.me'))
  ch.handlers.forEach((x) => x.cb({})); assert.equal(n, 2); h.close(); assert.deepEqual(c.removed, ['inbox:me'])
})
