# Community live chat (migration 010)

**Status: implemented; NOT verified against a real Supabase project, browser or Android device.** Unit tests cover the client logic with fakes and the SQL is
reviewed statically; the executable database proof is `supabase/tests/chat_rls.sql` (run `./scripts/verify-db.sh`; not yet run).

## What it does
- One-to-one chats and groups (2–50 members), inside **Community → Messages**. Unread badge on the tab; opening a chat from a notification uses `/community?chat=<id>`.
- Live delivery through Supabase Realtime (`postgres_changes` for messages/read marks; a private broadcast channel for typing and presence).
- Ticks: sent / delivered / read (server clock, only move forward). Typing indicator, online presence, last seen (can be hidden).
- Edit own text messages (24 h), delete own messages (removed for everyone, attachment file deleted), reply, search inside a chat, paged history ("Load earlier messages").
- Attachments: images, video, audio, voice messages, PDF/Office/text files up to 50 MB (voice 5 MB) in the private bucket `chat-media`; signed URLs (15 min–1 h) are re-signed on failure with visible errors.
- Failed sends stay on screen with **Retry** / **Discard**; a retry cannot duplicate a message (unique client id).
- Blocking, reporting a message, mute per chat, "allow new chats" and "show last seen" settings, notification per conversation (one alert that resurfaces on each new message).

## Privacy model (decisions)
| Rule | Why |
|---|---|
| Only active members read a conversation, its member list and its messages | RLS on every table; changes happen through checked functions |
| **Administrators cannot read private chats.** They see only a message that a member *reported* (a snapshot taken at report time) | avoids a general window into private conversations |
| A person added later sees messages only from the moment they joined; leaving ends access (also to attachments) | `history_from`, `left_at` |
| A block works both ways for starting/continuing a direct chat; you never see messages from someone you blocked | `community_blocks` |
| Suspended Community members cannot send; moderators can lock a conversation | `chat_can_send` |
| Attachment files: only the sender can upload (into `<sender>/<conversation>/`); **reading needs an active membership, a live message pointing at that exact file, `history_from`, and no block — there is no uploader shortcut (migration 011)**; files are immutable | storage policies + `chat_storage_can_*` |
| Typing/presence channels admit members only (Realtime Authorization on `realtime.messages`) | `chat_topic_member` |

## Setup notes (please verify in your project)
1. Apply `010_chat.sql` after 001–009. It adds the chat tables to the `supabase_realtime` publication and creates the `realtime.messages` policies **only if those exist**; if the SQL notice says Realtime was absent, enable it and re-run the last block.
2. In the Supabase dashboard check Realtime settings so private channels are enforced. Not verified by me.
3. `@supabase/supabase-js` must be 2.45+ (private channels). `package.json` requires `^2.45.0`; the lockfile resolves a newer version. A test checks this.
4. Roles come from Auth `app_metadata.role`; never `user_metadata`.

## Limitations (known, honest)
- **Not end-to-end encrypted.** Messages are protected by access rules, TLS and database encryption at rest, but the database operator can technically read them.
- Chat needs an internet connection. Offline, a message you write shows as *not sent* with Retry; nothing is queued silently. There is no push notification when the app is fully closed (only in-app alerts and the existing local reminders).
- Typing and presence are cosmetic; a member could fake another member's typing dot (they cannot read or write anything else).
- Group administrators can add/remove/rename; there is no transfer-ownership screen (the longest-standing member is promoted if the last admin leaves).
- The moderation screen for **chat reports** (`chat_reports`) is part of the admin dashboard and is not built yet; reports are stored and readable by administrators through the database only.
- Voice messages are built: see docs/VOICE.md.
- **Deleted messages leave unreadable bytes in storage until `scripts/cleanup-chat-media.mjs` runs** (see docs/VOICE.md). Schedule it if you need deleted attachments gone.
- Migration 010 alone contains the old, too-broad attachment read rule; **011 replaces it**. Always apply 011 after 010.
