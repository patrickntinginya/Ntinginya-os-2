// Voice screens, checked without a browser: every runtime message has Kiswahili, the Android manifest asks for the microphone,
// recordings are labelled for screen readers, and nothing can navigate away or send audio anywhere but the chat bucket.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import sw from '../src/i18n/sw.phrases.js'
import { VOICE_ERRORS } from '../src/lib/voiceRecorder.js'
import { VOICE_SAVE_ERRORS, voiceEligible, voiceItem } from '../src/lib/voiceOffline.js'
import { validateVoice, VOICE, formatDuration, playbackFraction } from '../src/lib/voiceFormat.js'
import { patchManifest, PERMISSIONS } from '../scripts/androidManifest.mjs'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const CONV = '22222222-2222-4222-8222-222222222222'; const ME = '11111111-1111-4111-8111-111111111111'

test('every voice message shown to a person has a Kiswahili translation', () => {
  const english = [...Object.values(VOICE_ERRORS), ...Object.values(VOICE_SAVE_ERRORS),
    validateVoice({ durationMs: 10, size: 1, mime: 'audio/webm' }), validateVoice({ durationMs: VOICE.maxMs + 5000, size: 1, mime: 'audio/webm' }),
    validateVoice({ durationMs: 1000, size: 0, mime: 'audio/webm' }), validateVoice({ durationMs: 1000, size: VOICE.maxBytes + 1, mime: 'audio/webm' }), validateVoice({ durationMs: 1000, size: 5, mime: 'image/png' })]
  assert.ok(english.every(Boolean))
  assert.deepEqual([...new Set(english)].filter((m) => !sw[m]), [])
})

test('Android: the microphone permissions are added to the generated manifest, once', () => {
  assert.ok(PERMISSIONS.includes('android.permission.RECORD_AUDIO')); assert.ok(PERMISSIONS.includes('android.permission.MODIFY_AUDIO_SETTINGS'))
  const base = '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n<application><activity android:name=".MainActivity" android:exported="true"></activity></application>\n</manifest>'
  const once = patchManifest(base); assert.match(once, /android\.permission\.RECORD_AUDIO/); assert.equal(patchManifest(once), once)
})

test('the recorder is operable without a mouse and announces itself', () => {
  const src = read('src/components/voice/VoiceRecorder.jsx')
  for (const part of ['aria-label={tr(\'Hold to record a voice message\')}', 'onKeyDown', "e.key === 'Escape'", "e.key === 'Enter'", 'role="status"', 'aria-live="polite"', 'role="alert"', 'setPointerCapture', 'onContextMenu', "touchAction: 'none'", 'onPointerCancel']) assert.ok(src.includes(part), part)
  for (const label of ['Stop recording', 'Cancel recording', 'Delete recording', 'Record again', 'Send voice message']) assert.ok(src.includes(`tr('${label}')`), label)
})

test('the player is accessible: labelled controls, a position slider with text, one voice at a time', () => {
  const src = read('src/components/voice/VoicePlayer.jsx')
  for (const part of ["tr('Playback position')", 'aria-valuetext', 'type="range"', 'let current = null', 'current.pause()', "tr('Play again')", "tr('Pause')"]) assert.ok(src.includes(part), part)
})

test('there is always a preview before sending, and the microphone is released when the screen goes away', () => {
  const src = read('src/components/voice/VoiceRecorder.jsx')
  assert.match(src, /st\.status === 'recorded' && st\.result/); assert.match(src, /<VoicePlayer src=\{url\}/); assert.match(src, /useEffect\(\(\) => \(\) => rec\.dispose\(\), \[rec\]\)/)
  assert.ok(!/onSend\([^)]*\)[^;]*stop\(\)/.test(src), 'releasing the button never sends by itself')
})

test('voice screens never navigate away or open other sites', () => {
  for (const f of ['src/components/voice/VoiceRecorder.jsx', 'src/components/voice/VoicePlayer.jsx', 'src/components/chat/SavedVoice.jsx']) {
    const src = read(f); assert.ok(!/<a\s|target=["']_blank|window\.open|location\.(href|assign|replace)/.test(src), f)
  }
})

test('saved voice messages: only a chat voice file of the right shape and size is eligible; the record keeps the conversation id for later cleanup', () => {
  const item = { id: 'm', storage_path: `${ME}/${CONV}/v.webm`, media_type: 'audio', size_bytes: 1000 }
  assert.equal(voiceEligible(item).ok, true)
  for (const bad of [{ ...item, media_type: 'video' }, { ...item, storage_path: 'shared/x/y.webm' }, { ...item, storage_path: `${ME}/${CONV}/a/b.webm` }, { ...item, size_bytes: VOICE.maxBytes + 1 }, { ...item, size_bytes: 0 }, null]) assert.equal(voiceEligible(bad).ok, false)
  const made = voiceItem({ id: 'm', kind: 'voice', media_path: item.storage_path, media_mime: 'audio/webm', media_size: 1000, duration_ms: 4200, created_at: 't', sender_id: ME }, { senderName: 'Ana', conversationTitle: 'Team' })
  assert.deepEqual([made.extra.conversation_id, made.extra.duration_ms, made.title, made.visibility], [CONV, 4200, 'Ana', 'chat'])
  assert.equal(voiceItem({ id: 'm', kind: 'voice', media_path: item.storage_path, deleted_at: 'x' }), null, 'a deleted message cannot be saved')
  assert.equal(voiceItem({ id: 'm', kind: 'text', body: 'hi' }), null)
})

test('leaving or losing a conversation removes its saved voice messages from the device', () => {
  const view = read('src/components/chat/ConversationView.jsx'); const hook = read('src/hooks/useVoiceSaved.js')
  assert.match(view, /onLeft=\{\(\) => \{[^}]*voice\.purgeConversation\(\)/); assert.match(view, /c\.error\.message === 'not_found'/)
  assert.match(hook, /meta\.extra\.conversation_id === conversationId/); assert.match(hook, /if \(m\.deleted_at && metas\[m\.id\]\) removeLocal\(m\.id\)/)
})

test('playback helpers: stored length wins over the element (recorded WebM reports Infinity); clock text', () => {
  assert.equal(playbackFraction(2, 8000, Infinity), 0.25); assert.equal(playbackFraction(2, 0, 10), 0.2); assert.equal(playbackFraction(9, 8000, Infinity), 1); assert.equal(playbackFraction(1, 0, Infinity), 0)
  assert.deepEqual([0, 7000, 65000, 750000].map(formatDuration), ['0:00', '0:07', '1:05', '12:30'])
})

test('the chat composer swaps in the recorder when the box is empty and sends kind=voice with its duration', () => {
  const c = read('src/components/chat/ChatComposer.jsx')
  assert.match(c, /const showMic = !editing && !text\.trim\(\) && !file/); assert.match(c, /kind: 'voice', durationMs/)
  const b = read('src/components/chat/MessageBubble.jsx'); assert.match(b, /m\.kind === 'voice' \? <VoiceNote/); assert.match(b, /role="progressbar"/)
  assert.match(read('src/hooks/useConversation.js'), /onProgress: args\.file \? onProgress : null/)
})

// ---------- Community voice posts and comments (screens)
import assert2 from 'node:assert/strict'
import fs2 from 'node:fs'
import test2 from 'node:test'
const rd = (p) => fs2.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
test2('a voice post can be recorded in the composer, previewed, removed, and is posted with its duration and upload progress', () => {
  const c = rd('src/components/community/Composer.jsx')
  for (const part of ['<VoiceRecorder onSend={(v) => setVoice(v)}', 'onActiveChange={setRecording}', 'voice, allowComments, onProgress', "tr('Remove voice message')", '!body.trim() && !file && !voice', '!file && !voice && !busy']) assert2.ok(c.includes(part), part)
  assert2.ok(c.includes('<VoicePlayer src={voiceUrl} durationMs={voice.durationMs}'), 'preview before posting')
})
test2('a voice post is played on the post card from the signed link, with its stored duration', () => {
  const c = rd('src/components/community/PostCard.jsx')
  assert2.match(c, /post\.media_kind === 'voice' && media && .*<VoicePlayer src=\{media\} durationMs=\{post\.duration_ms\}/)
})
test2('voice comments: recorded in the comment box, sent with the author id, signed with retry handling, played in the thread, deleted with their file', () => {
  const c = rd('src/components/community/Comments.jsx')
  for (const part of ['validateComment(text, { voice: Boolean(voice) })', 'userId: me, voice', 'signCommentMedia(need)', "c.media_kind === 'voice'", 'await deleteComment(c);', '!text.trim() && !voice']) assert2.ok(c.includes(part), part)
  const s = rd('src/services/community.js'); assert2.match(s, /export const signCommentMedia = .*signUrls\(supabase, BUCKET/)
})
test2('community voice never opens another site or page', () => {
  for (const f of ['Composer', 'PostCard', 'Comments']) { const src = rd(`src/components/community/${f}.jsx`); assert2.ok(!/window\.open|target=["']_blank/.test(src), f) }
})

test2('saved voice messages stay reachable when Community cannot load (offline): the error screen also shows the device-only list', () => {
  const c = rd('src/pages/Community.jsx')
  assert2.match(c, /if \(error\) return <div[^\n]*<ErrorState [^\n]*\/><SavedVoice me=\{user\.id\} \/><\/div>/)
  assert2.ok(c.includes("import SavedVoice from '../components/chat/SavedVoice'"))
  const sv = rd('src/components/chat/SavedVoice.jsx'); assert2.ok(!/supabase|fetch\(/.test(sv), 'the saved list never touches the network')
})
