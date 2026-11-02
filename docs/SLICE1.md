# V6 – Slice 1: Community in main navigation + Smart Action Center

Status vocabulary (from the master prompt): **A** implemented and tested here · **B** awaiting external credentials · **C** implemented, awaiting deployment verification · **D** not implemented.

## What exists
| Area | What it does | Status |
|---|---|---|
| Navigation | Community is a main item in the sidebar (desktop) and the mobile bottom bar (Home, Today, AI, Finance, Community, More). It is not in `SECONDARY_ITEMS`. | A (list/route logic) · C (rendering on a real Android screen) |
| Community | Profiles (join with a display name), text/image/video posts, comments + replies, reactions, groups (public/private, membership, group feed), search, trending, reports, user blocking, admin moderation panel, notifications for comments/reactions. | A (rules and client logic) · C (database behaviour) |
| Smart Actions | `notifications` extended with `action_kind`, `action_ref`, `due_at`, `status`, `snoozed_until`. DO IT runs the real action (complete reminder / complete task with confirmation / log habit / open screen) through `notification_begin_action` → action → `notification_finish_action`. REMIND ME AFTER 5M uses `notification_snooze` (server clock, fixed 5 min, a second press returns the same reminder). `notification_wake_due` brings snoozes back exactly once. | A (logic with fakes) · C (SQL on Postgres) |
| Notification Center | Keyset pagination (never a fixed small cap), filters All / Unread / Read / Overdue / Upcoming, category filter, debounced search, mark read, mark all read, delete with confirmation, counts. | A (filter/pagination logic) · C (UI in a browser) |
| Device alerts | Android: one OS alarm per snoozed notification with a stable id (scheduling twice replaces it), buttons registered before the first alarm, restored on app start/resume. Web: service-worker notification buttons (`public/sw-actions.js`) + timer while the app is open. | C (needs a phone / browser) |

## Honest limits
- **Web, app fully closed:** a browser cannot be woken without a push server. The snoozed notification returns the next time the app opens. Web push (VAPID + server scheduler) is **D – not implemented**.
- **Android reboot / battery savers:** relies on the Capacitor plugin restoring alarms (`RECEIVE_BOOT_COMPLETED`) and the app rebuilding them on next open. Not tested on a device. Some manufacturers kill alarms.
- Notification types for appointments, payments, subscriptions and security are allowed by the database, but their generators arrive with later slices.
- Community video/image uploads use a private `community-media` bucket (50 MB limit, own-folder write policy). Not exercised against real Storage.

## Security rules enforced in SQL (007, 008)
Admin only from `app_metadata.role` (never `user_metadata`); status/moderation columns are admin-only via guard triggers; suspended members cannot post, delete-and-recreate their profile, or re-join banned groups; posts cannot be moved into groups the author is not in; group roles are owner-only; per-user rate limits; one report per member per target; reaction notifications cannot be farmed by toggling.

## Verification you must run (not possible in the build sandbox)
1. `npm ci && npm test && npm run build` on a machine with internet (the sandbox could not install dependencies, so `vite build` was **not** run).
2. Apply migrations 006 → 007 → 008 in the Supabase SQL editor, then run `supabase/tests/slice1_rls.sql` and `supabase/tests/rls_isolation.sql`; every notice must say PASS.
3. Create an admin: set `app_metadata.role = "admin"` for your user in Supabase Auth (Dashboard or service-role API). Never `user_metadata`.
4. On an Android phone: press DO IT and REMIND ME AFTER 5M on a reminder; close the app; restart the phone; confirm the alert returns.

## Files changed vs. the supplied ZIP
Modified: `src/App.jsx`, `src/layouts/AppLayout.jsx`, `src/lib/navigation.js`, `src/lib/tables.js`, `src/pages/Notifications.jsx`, `src/services/notifications.js`, `src/utils/notificationRules.js`, `src/native/{NativeBridge.jsx,localNotifications.js,runtime.js}`, `src/i18n/{en.js,sw.js,sw.phrases.js}`, `vite.config.js`, `tests/{android-foundation,android-native,schema}.test.js`.
New: `supabase/migrations/{006_smart_actions,007_community,008_slice1_hardening}.sql`, `supabase/tests/slice1_rls.sql`, `public/sw-actions.js`, `src/pages/Community.jsx`, `src/components/community/*` (10 files), `src/components/notifications/NotificationCard.jsx`, `src/hooks/useSmartActions.js`, `src/lib/smartActionCore.js`, `src/services/{community,reminderActions,snoozeScheduler}.js`, `src/utils/{community,smartActions}.js`, `tests/{community,slice1-hardening,smart-actions}.test.js`.
Migrations 001–005 are untouched. No dependency was added.
