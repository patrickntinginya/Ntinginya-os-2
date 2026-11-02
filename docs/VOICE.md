# Voice messages, voice posts and voice comments

**Status: implemented; NOT verified in a real browser, on an Android device, or against a real Supabase project.** The recorder state machine, format
choice, limits, upload logic, player maths and offline rules are unit-tested with fakes; the SQL is reviewed statically and `supabase/tests/chat_rls.sql`
(not yet run) is the executable proof. Microphone capture, audio playback and upload progress have never run on real hardware by me.

## Where it works
| Where | Record | Play | Limits enforced by |
|---|---|---|---|
| Chat (one-to-one and group) | mic button replaces *Send* while the box is empty | in the bubble | app + constraint `chat_messages_voice_limits` (011) + real-size trigger (013) |
| Community posts | mic in the post composer (text optional) | on the post card | app + constraint `community_posts_voice_limits` + trigger (013) |
| Community comments and replies | mic in the comment box (text optional) | in the thread | app + constraint `community_comments_voice_limits` + trigger (013) |

## Recording
- **Press and hold** the microphone and speak; **release** to open the preview; **slide left and release** to cancel.
- A **quick tap** starts a *latched* recording (Stop / Cancel buttons) — also the keyboard / screen-reader way (Enter or Space to start and stop, Escape cancels).
- Always a **preview**: play it, **delete**, **record again**, or **send**. Nothing is uploaded before *Send* / *Post*.
- Limits: **0.5 s minimum** (shorter = accidental tap), **5 minutes** maximum (recording stops by itself and keeps what was said), **5 MB** maximum.
- The microphone is released the moment recording ends, is cancelled, fails or the screen closes. Cancelling while the permission prompt is open is handled.
- Errors are explained in English and Kiswahili: permission denied (with where to allow it), no microphone, microphone in use, insecure (non-https) page, unsupported device, too short, too big.

## Format and compression
The browser's own `MediaRecorder` does the compression (there is no server-side transcoding): **Opus in WebM/Ogg** (Chrome, Edge, Firefox, Android WebView) at **24 kbit/s mono**
(about 180 KB per minute, so a 5-minute note is about 0.9 MB) or **AAC in MP4** (Safari / iOS) at 32 kbit/s. Echo cancellation, noise suppression and auto gain are requested.
Content types are sent without codec parameters (`audio/webm`, not `audio/webm;codecs=opus`) because bucket allow-lists compare the plain type.

## Playback
Play / pause / resume / play again, a position slider, `0:03 / 0:07`. Only one message plays at a time. Total length comes from the duration stored at recording time, because
`MediaRecorder` WebM files usually report an infinite duration. **Seeking inside a recorded WebM can be unreliable in some browsers** (not tested).

## Upload progress
Chat and Community show a percentage bar. It uses `XMLHttpRequest` against the Storage REST endpoint (`POST /storage/v1/object/<bucket>/<path>`, raw body, user token),
because supabase-js has no progress callback. **This request style has not been checked against a real project.** If Storage answers 400/415 the app falls back to supabase-js
(no percentage, message still sends); real failures (network, 401/403, 413) are shown and are not retried through the fallback.
A **Retry** after "file uploaded but message not saved" works: an "already exists" answer for that message's own path is treated as "already uploaded" (tested).

## Security (what the database enforces)
- **Chat attachments (migration 011):** a file is readable only while ALL are true: a message points at exactly that file; it is in that conversation and was sent by the folder's owner;
  the message is not deleted; the caller is an **active member now**; the message is not older than the caller's `history_from`; the caller has not blocked the sender.
  There is **no "I uploaded it" shortcut**: someone who left or was removed cannot read even their own attachments, and an uploaded file that never became a message is unreadable by everyone.
- **Chat voice limits (011):** 0.5 s–5 min, ≤ 5 MB, audio type, duration required — a modified client cannot skip them.
- **Real size/type (013):** before a voice row is stored, a trigger reads the uploaded object's own metadata in Storage and rejects a file over 5 MB or not `audio/*`
  (the size a client states could be false). It **fails open** if the object or a metadata key is missing, on purpose, so a platform detail cannot stop all sending; verify on your project.
- **Community voice (013):** comment voice is readable under exactly the rules of the comment and its post (visible, not blocked, public group or member of the private group).
- Roles come only from Auth `app_metadata.role`; administrators cannot read chat attachments.

## Deleted messages: files stay until the cleanup job runs  (decision to confirm)
Because of 011, once a message is deleted nobody can read its file — but the **Storage API cannot delete it either** (deleting needs read access, which is exactly what was removed).
The app deletes the file *before* the message when it still can; when it cannot (for example the sender already left the group) the bytes remain, unreadable, until
`node scripts/cleanup-chat-media.mjs --delete` runs with the **service role key** (from your computer or a scheduled job, never from the app; dry run by default).
**Schedule it** (for example daily) if "deleted means gone from storage" matters to you. Not run against a real project yet.

## Offline voice
In a chat, **Save on this device** stores a voice message in a per-user database `ntinginya-offline-voice-<userId>` (separate from Safe Mode's). Only a live message you can read now can be saved.
Saved copies are removed when you remove them, when you leave or lose the conversation, or when the message turns out to be deleted. They appear under **Messages → Saved voice messages**, and also
on the Community error screen so they stay playable with **no internet** (only the device's storage is read). Whether the whole app opens offline on your phone is **not tested**.
Saved copies cannot be un-saved remotely: a person who leaves keeps copies they saved earlier until the app notices the lost access (next time they open the conversation).

## Android
`RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` are added by `scripts/androidManifest.mjs` (see docs/ANDROID_BUILD.md). Without `RECORD_AUDIO` the WebView refuses microphone access.
Android asks the person the first time they record; if they deny, the app explains how to allow it. **Not tested on a device.**

## Not built / known limits
No waveform, no transcription, no speed control, no seeking guarantee, no push notification when the app is closed, no background recording, chat is not end-to-end encrypted.
Voice posts/comments cannot be downloaded for offline use (only chat voice messages can).

## What you must run to verify this feature
1. `npm ci && npm test && npm run build`
2. `./scripts/verify-db.sh` (runs `chat_rls.sql`, including the 011 attachment cases)
3. On a disposable Supabase project: send voice in a chat and in a post; check the progress bar, the removed-member case, and that a >5 MB or non-audio object is refused
4. On an Android phone: first-time microphone prompt, deny and allow paths, hold-to-record, preview, playback, save for offline, airplane-mode playback
5. In Chrome, Firefox and Safari (iOS): which format was recorded and that it plays on the other platforms
