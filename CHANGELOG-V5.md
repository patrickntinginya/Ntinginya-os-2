# Personal Life OS - V5 changelog

## How the AI backend works now (Vercel)
`POST /api/ai-chat` is a native Vercel Node function (`api/ai-chat.js`, logic in `api/_lib/ai/`). No Netlify code is involved.
Flow: origin check (CORS) -> Supabase `getUser(token)` with the caller's own token -> profile `ai_enabled` check -> input validation ->
burst + daily limits -> Gemini call from the server -> proposed actions stored as PENDING (the user confirms in the app).
`GET /api/ai-chat?status=1` reports configuration only (provider, model, configured true/false); it never returns keys.
CORS: same-origin always; Android app origin `https://localhost`; extra origins only via `AI_ALLOWED_ORIGINS`; anything else gets 403.

## Vercel environment variables (names only)
Required: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (also read server-side), `GEMINI_API_KEY`.
Optional: `AI_PROVIDER` (default gemini), `GEMINI_MODEL`, `AI_MAX_TOKENS`, `AI_DAILY_LIMIT`, `AI_ALLOWED_ORIGINS`.
GitHub (Android build) variable: `VITE_API_BASE_URL` = your STABLE production domain (https origin; any path is dropped).
**Use the production domain, not a per-deployment URL**: per-deployment URLs can sit behind Vercel Deployment Protection, which answers the APK with an HTML login page.

## Supabase SQL to run once
`supabase/migrations/004_v5.sql` (after 001-003): adds `reflections`, `habit_safe_mode`, `habit_entries.safe_mode`, all with owner-only RLS. Additive; safe to re-run.
Until it is run, Reflections and Safe Mode show a "not set up yet" message; everything else works.

## What was added
- Motivation & Recovery Center (`/motivation`): Daily, Morning, Night, Videos, Audio, Images, Need-a-pause tabs; English + Kiswahili; favourites; routines that reset daily; add-to-tasks (one task per day, no duplicates); AI encouragement (only what you type is sent; hidden offline); smart-reminder switches.
- Pause / Emergency mode (`/calm`): breathing, 5-4-3-2-1 grounding, one small action, link to the Center, optional private reflection. No automatic contact, no medical claims.
- Habit Safe Mode (Habits -> expand a habit): smaller version, optional recovery end date, exit any time. Doing the smaller version records a normal entry flagged safe_mode. Empty days stay missed. History and best streak are never changed.
- Streaks (`src/utils/streaks.js`): current, best, last miss, restart/comeback messages, milestones 3/7/14/30/60/100/180/365; rules shown in the app.
- Reflections (`/reflections`): mood, energy, went well, difficult, tomorrow action, free text; grouped by date; search; edit/delete own entries.
- Smart reminders: 4 optional rituals (morning, night, plan my day, weekly check-in) stored as ordinary `reminders` rows with a time you choose, so the existing Reminders screen, in-app notifications and Android alarms handle them.
- Media: NO third-party videos/audio/images are bundled and no URLs were invented. Add verified links in `src/lib/motivationContent.js` (CURATED_*) or let users add links (saved on that device only). Video embeds only start after a tap (no autoplay).

## Bugs fixed / changes
- AI endpoint rewritten natively (body-parsing/forwarding wrapper replaced; `null`/non-object JSON bodies no longer cause a 500; same-origin web requests with an Origin header are no longer rejected).
- Gemini: if `GEMINI_MODEL` is unset and the default model is rejected, one retry with `gemini-2.5-flash`.
- `VITE_API_BASE_URL` reduced to its origin (no duplicated paths).
- `vercel.json`: SPA rewrite excludes `/api/`; `netlify.toml` no longer declares functions.
- "npx netlify dev" wording replaced by "vercel dev".
- Old "Phase 1/2 adds no SQL" tests updated to expect the single new migration.

## Tests / build
`npm test` runs all suites (Node test runner). `npm run build` needs a normal `npm install`.
Android: rebuild the APK (new screens + `VITE_API_BASE_URL`); no new native plugin was added.

## Known limitations
- Not verified with real services: authenticated AI chat on Vercel, the Supabase RLS policies, YouTube embedding inside the Android WebView.
- Kiswahili was written for this app; have a native speaker review it.
- Media links/favourites/routine ticks are stored on the device, not in Supabase.
- Weekly check-in repeats weekly from the day it is switched on. Browsers cannot fire alerts while the app is closed; the Android app schedules alerts on the phone.
- Safe-mode quick button and streak notes are on the Habits screen only; Insights/Dashboard are unchanged.
