# Changelog

## V6 voice messaging + attachment-access security fix
- Migration 011: chat attachments readable only through a live message by an active, in-history, non-blocking member (no uploader shortcut); voice limits as a constraint.
- Migration 012: `chat_media_unattached` view (service role only) + `scripts/cleanup-chat-media.mjs`. Migration 013: voice posts and comments, real-size trigger, comment-voice read rule.
- Voice messages in chat (hold/latch/keyboard recording, preview, re-record, upload percentage, player, save for offline), voice posts and voice comments in Community.
- Fixed: retry after "uploaded but not saved" no longer fails with "already exists"; saved voice messages reachable when Community cannot load offline.
- docs/VOICE.md; DATABASE_VALIDATION, CHAT, ANDROID_BUILD, ROADMAP updated. Marketplace, bookings and the admin dashboard are next.

## V6 corrections + Community live chat
- Safe Mode signed URLs: all error paths checked, transient retry, specific messages, retry button (`src/lib/signedUrls.js`).
- Tests no longer depend on `lucide-react` being installed; a separate check verifies icon names when it is.
- Migration 010: one-to-one and group chat (RLS, history cut-off, blocks, reports as snapshots, private `chat-media` bucket, Realtime authorization, one resurfacing notification per conversation).
- Community → Messages: inbox with unread badge, live conversation (typing, presence, last seen, sent/delivered/read ticks, edit/delete/reply/search, attachments, retry), group info, privacy settings, report/block.
- 72 Kiswahili phrases added; `supabase/tests/chat_rls.sql`; docs/CHAT.md. Voice messages are next.

## V6 roadmap change + Offline Media Library
- Payments, commissions, payouts, refunds and payment disputes removed from scope (docs/ROADMAP.md). No placeholders.
- Safe Mode library rewritten as an offline-capable library: download/progress/cancel/retry/update/remove, search, favorites, filters, offline listing, per-user IndexedDB storage, cloud sync. Fixes a race that could start two downloads of one file.
- One batched request signs all media URLs instead of one request per file; the "Open" link that left the app is gone.

## V6 Slice 1 corrections + Safe Mode YouTube (Slice 2, part 1)
- Migration 009: community-media storage RLS, private-group rules, hardened DO IT / snooze (claim ids, audit-bound finish, protected columns).
- Safe Mode: YouTube plays in-app via the official IFrame API; embed-blocked videos are explained in place; no link leaves Safe Mode.
- `scripts/verify-db.sh` + `supabase/tests/local_bootstrap.sql` to validate migrations and RLS on a disposable Postgres.

## V6 Slice 1 – Community (main navigation) + Smart Action Center
- Community added to the sidebar and the mobile bottom bar; full Community module (profiles, posts with image/video, comments, reactions, groups, search, trending, reports, blocks, moderation).
- Notifications upgraded: DO IT / REMIND ME AFTER 5M, idempotent server functions, keyset pagination, Unread/Read/Overdue/Upcoming filters, categories, search.
- Migrations 006 (smart actions), 007 (community), 008 (hardening). 001-005 unchanged.
- Fix: the native snooze alarm now registers its channel and buttons before its first use.
- Tests: three stale allow-lists updated (new migrations / one new guarded SQL function); two over-strict Community tests corrected (a SQL comment matched `user_metadata`; `_` is stripped as a LIKE wildcard); 3 new tests. See docs/SLICE1.md.

## AI routing, health monitoring and automatic failover
- `api/_lib/ai/handler.js` now sends every model call through `routeModel()` (bounded retry -> failover -> health). Before this change `router.js`, `health.js` and the OpenRouter adapter existed but the handler called the provider directly, and `provider.js` lacked `resolveNamed`, so `tests/ai-router.test.js` could not load.
- `provider.js`: added `resolveNamed()`, registered `openrouter`; the OpenRouter address cannot be changed by `AI_BASE_URL`; a missing/invalid `OPENROUTER_MODEL` reports "not configured".
- Status endpoint (`GET ?status=1`) lists only configured providers (names and coarse health). New admin-only `GET ?diagnostics=1`.
- Fixed: a successful retry on the same provider was reported as `fallback_used`.
- Added a streaming guard in the router (`partialSent`), a `cancelled` reply code, `request_id` on replies and `provider`/`fallback_used` on answers.
- Settings -> AI: provider picker (only when more than one provider is configured) and an administrator diagnostics card. Chat shows which provider answered after a fallback.
- English/Kiswahili strings added to `src/i18n/sw.phrases.js`.
- Tests: `tests/ai-failover-e2e.test.js` (21 tests). Docs: `docs/AI_SETUP.md`, `TEST_REPORT.md`. `.env.example` updated (placeholders only).
- No SQL migration was added or changed in this package.

Earlier history: see `CHANGELOG-V5.md`.
