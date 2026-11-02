# Test report – V6 (attachment-access fix, voice messages, voice posts and comments)

Words used below: **EXECUTED** (it really ran; result shown) · **NOT EXECUTED** (it did not run; nothing is claimed) · **SKIPPED** (the test ran and declared it cannot verify).

## 1. EXECUTED in the build sandbox (no internet, no PostgreSQL, no browser, no phone, no microphone)
| Check | Result |
|---|---|
| `npm test` with **no `node_modules` at all** (no stub) | **558 tests: 557 pass, 0 fail, 1 skipped** |
| Syntax parse of all 266 `.js/.jsx/.mjs` files (TypeScript parser) | 0 errors |
| Static import/export check across 200 src files | 0 problems |

The **1 skipped** test is `tests/icons.test.js` (real `lucide-react` icon names): it skips itself until `npm ci` has run, so **icon names are still NOT verified**.

## 2. NOT EXECUTED  (each needs your machine / a real project / a phone)
| Required check | Status | How |
|---|---|---|
| `npm ci` | **NOT EXECUTED** (registry unreachable) | `npm ci` |
| `npm run build` | **NOT EXECUTED**; the old "vite: Permission denied" is still undiagnosed | `npm run build` |
| Migrations 001–013 on PostgreSQL; `rls_isolation.sql`, `slice1_rls.sql`, `chat_rls.sql` | **NOT EXECUTED** (the scripts are written and structure-checked only) | `./scripts/verify-db.sh` |
| Supabase Realtime (delivery, typing, presence, private channels) | **NOT EXECUTED** | disposable Supabase project |
| Real Storage behaviour: upload progress request style, "already exists" answer, DELETE needing read access, object metadata used by the voice size trigger | **NOT EXECUTED** | disposable Supabase project |
| Microphone recording, audio playback, formats per browser (Chrome / Firefox / Safari) | **NOT EXECUTED** | real browsers |
| **Android** (WebView microphone prompt, hold-to-record, playback, notification buttons, offline) | **NOT EXECUTED** | device test |
| The cleanup script `scripts/cleanup-chat-media.mjs` | **NOT EXECUTED** | dry run on a disposable project |

No production-build success, database-security verification, Realtime success, Android success or browser success is claimed anywhere in this delivery.

## 3. The chat attachment security fix (your item 1)
- **Fix:** migration `011_chat_attachment_access.sql` replaces `chat_storage_can_read()`. There is **no ownership shortcut any more**. A file is readable only if a live (non-deleted) message points at exactly that file, the message is in that conversation and from that folder's owner, the caller is an **active member now**, the message is not older than the caller's `history_from`, and the caller has not blocked the sender. 010 itself is left unchanged (apply 011 right after it).
- **Static tests (executed, pass):** `tests/chat-db.test.js` and `tests/voice-db.test.js` read the SQL and assert every one of those conditions, that there is no owner shortcut, that the function is still `security definer` with a pinned search_path, and that no grant was widened.
- **Database tests (written, NOT executed):** `supabase/tests/chat_rls.sql` section 8b proves, on a real database: the sender can read while a member; an uploaded-but-never-sent file is unreadable by everyone; a blocker cannot read the blocked sender's file; another member can; after deleting the message not even the sender can; a **removed** member cannot read **even their own** attachment; a **re-added** member cannot read files from before they re-joined (`history_from`); a member who **left** cannot; a former member cannot; the administrator cannot.
- **Consequence you should know:** after a message is deleted nobody can read its file, and the Storage API cannot delete it either (deleting needs read access). The app deletes the file before the message when it still can; otherwise the bytes stay, unreadable, until `scripts/cleanup-chat-media.mjs` runs. Schedule it. (docs/VOICE.md)

## 4. What the voice work consists of, and my review of it
Some of the code and migrations (011–013, the voice libraries/components, saved-voice list, cleanup script and their tests) were already in the working tree when this turn began and were not written by me in this conversation. I audited them against your requirements rather than trusting them. Findings:
1. **Bug fixed (retry):** a voice/file upload that succeeded but whose message insert failed could never be retried: the retry re-uploaded to the same path and failed with "already exists". An "already exists" answer for the message's own path is now treated as "already uploaded" (`isAlreadyUploaded`; 3 tests, including that genuine failures such as 401/413/500 are still errors).
2. **Gap fixed (offline voice):** saved voice messages sat inside Community → Messages, which is unreachable offline because the profile request fails and only an error screen is shown. The Community error screen now also lists the saved voice messages (device storage only; tested statically).
3. **Gap closed (voice posts and comments):** the services and migration existed but no screen could record one. Built: recorder + preview + upload percentage in the post composer and the comment box, `VoicePlayer` on post cards and in comment threads, signed links for voice comments with the shared retry handling, deletion of the file with the comment. 5 new Kiswahili phrases.
4. Guard tests reacting to legitimate new things were updated precisely (new `voice_*` security-definer functions must pin `search_path` and are checked in `voice-db.test.js`; the per-user IndexedDB test now covers the separate voice database). SQL limits and JavaScript limits are asserted to be the same numbers.

## 5. What the tests cover (all with fakes or static reads)
`voice-recorder` (state machine, permission errors, format choice, limits, microphone release, cancel during the permission prompt, hold/latch/slide gesture) · `voice-ui` (accessibility attributes, Kiswahili for every voice string, saved-voice eligibility and cleanup rules, composer/bubble/post/comment wiring, no navigation away) · `voice-db` (011–013 static review, JS/SQL limit parity) · `chat-retry` · `chat-service` (voice send, upload progress, fallback rules) · `chat-db`, `chat-realtime`, `chat-utils`, `offline-media`, `offline-ui`, `signed-urls`, `youtube-session`, `slice1-*`, `smart-actions`, `community`, `i18n`, `schema`, `android-*`.

## 6. Open questions / decisions for you
- **Cleanup job:** are you willing to schedule `cleanup-chat-media.mjs` (service role key kept outside the app)? Without it, deleted attachments remain as unreadable bytes.
- **Fail-open size trigger:** `voice_object_within_limits` allows a voice row when Storage metadata is missing, so a platform detail never blocks sending. Say if you prefer fail-closed.
- **Private groups** remain discoverable by name (earlier decision, unchanged).

## 7. Not started
Professionals marketplace, appointments and booking, the admin dashboard (including chat-report moderation), subscriptions/AI credits (admin-granted only; payments stay out of scope).

Earlier AI-routing report: see `docs/AI_SETUP.md`. Slice 1 detail: `docs/SLICE1.md`.

---
# Earlier report (AI routing package)

## Run
| Command | Result |
|---|---|
| `npm test` (`node --test tests/*.test.js`) before changes | 321 tests: 320 pass, **1 fail** (`tests/ai-router.test.js` could not load: missing export `resolveNamed`) |
| `npm test` after changes | **369 tests, 369 pass, 0 fail** |
| esbuild syntax check of the 6 changed front-end files + a bundle of `src/main.jsx` with packages marked external | passed (this is NOT the production build) |

## Covered by automated tests (mocked providers and a recording database stand-in; no network)
Primary success without touching OpenRouter; timeout, 429 and 5xx fallback; bounded retry (never a third call); successful retry without fallback flag; invalid key not retried and skipped during cool-down; missing secondary credentials; missing primary key; both providers failing (safe error, request id, nothing stored, no leaked secrets); both timing out; both rate limited; malformed provider replies; explicit selection (no silent switching, hostile provider value ignored); identical system prompt/history/language on the fallback attempt; long answers whole; connection test without retries; streaming guard; diagnostics authorization (no token, rejected token, ordinary user, `user_metadata` admin all refused; `app_metadata` admin allowed; no secrets); deadline under the 30 s limit; browser preference helper. Health cool-down/recovery and half-open probing are in `tests/ai-router.test.js`.

## NOT run, and why
- **Production build (`vite build`): not completed.** `node_modules/vite` in this environment is an empty folder and there is no network to install it. Run `npm ci && npm run build` locally or in Vercel before deploying.
- Linting / type checks: none are configured in `package.json`.
- Real Gemini / OpenRouter calls: not made (no keys, no network). Real model IDs, real rate-limit headers and real latencies are unverified.
- Browser testing, Android build/APK, Supabase SQL: not performed. **No SQL was executed**; no migration was changed.
- The `Settings.jsx` picker and diagnostics card, and the chat fallback note, have been syntax-checked only, not rendered or clicked.

## Scope
This delivery implements only the "Advanced AI routing, health monitoring and automatic failover" section. The Community, Professionals, Appointments, Learning, offline-first, notification, top-bar and role-aware registration work from the earlier master prompts is **not** included.

## Known limitations
Health state is per serverless instance. Cancellation is best-effort on Vercel's Node adapter. There is no streaming. OpenRouter has no default model (set `OPENROUTER_MODEL`).
