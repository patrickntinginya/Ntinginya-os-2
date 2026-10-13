# Personal Life OS for Android (Phase 2)

Read this first: **Nothing in Phase 2 has been run on a phone, and `npm install`, `npm run build` and the APK build have NOT been run by the author** (no network in the authoring environment). What *was* run is listed in the final report. Treat every "should" below as a claim you must verify on a real device.

## 1. What the Android app is
The same React app as the website, packaged with Capacitor 7 (`@capacitor/core|android|cli ^7.0.0`, `@capacitor/app ^7.0.0`, `@capacitor/local-notifications ^7.0.0`). The `android/` project is **generated** by `npx cap add android` (not committed). Same Supabase project, same accounts, same data, same Row Level Security. No SQL was added or run.
Everything Android-specific is gated by `isNativePlatform()` (`src/lib/platform.js`) and lives in `src/native/*`, `src/lib/{apiBase,authRedirect,reminderSchedule,uuid}.js`, `src/services/{authDeepLink,offlineStorage,reminderSync}.js`. The website behaves as before.

## 2. Android permissions (added to the generated manifest by `scripts/android-configure.mjs`)
| Permission | Why |
|---|---|
| `INTERNET` (Capacitor template) | Talk to Supabase. |
| `POST_NOTIFICATIONS` | Show notifications on Android 13+. The app asks only when the user taps "Turn on device notifications". |
| `RECEIVE_BOOT_COMPLETED` | Lets the notifications plugin restore alarms after a reboot. |
| `SCHEDULE_EXACT_ALARM` | Lets reminders fire at the exact minute (Android 12+). On Android 14+ it is **off by default** for new installs; the user must allow "Alarms & reminders" (the app shows a button when it is off). |
Not requested, by design: overlay (`SYSTEM_ALERT_WINDOW`), accessibility, usage access, location, storage, contacts, camera. `USE_EXACT_ALARM` is not used (Google Play restricts it to alarm/calendar apps).
The script also sets `launchMode="singleTask"` (if missing) and adds the deep-link filter for `com.ntinginya.personallifeos://login` and `://reset-password`.

## 3. Owner action: Supabase Redirect URLs (NOT done by the author)
Supabase dashboard -> Authentication -> URL Configuration -> **Redirect URLs**: ADD these two (keep your existing website URLs and Site URL unchanged):
```
com.ntinginya.personallifeos://login
com.ntinginya.personallifeos://reset-password
```
Until they are added, sign-up confirmation and password-reset emails opened from the phone will not return to the app. **Nobody has configured or verified this in the live dashboard.**
How it works: the app asks Supabase to redirect to those addresses (Android only; the website still uses `https://<site>/login` and `/reset-password`). The email link opens the app; the tokens in the link go straight to `supabase.auth.setSession` and are never logged, stored or put in a route. A link is accepted only if this app requested one in the last 24 hours (blocks another app on the phone from signing you into someone else's account).
Email templates: if you customised them, keep the `{{ .ConfirmationURL }}` link. The `implicit` flow (tokens after `#`) is what the code expects; verify on a device that your project's emails produce it.

## 4. Owner action: the AI backend address (NOT established by the author)
The repository contains **no deployed URL**, so none was invented. Inside the app the page origin is `https://localhost`, so a relative `/api/ai-chat` cannot reach your server.
- Set **`VITE_API_BASE_URL`** (public https origin, no path, e.g. `https://your-site.example`). GitHub: Settings -> Secrets and variables -> Actions -> **Variables** -> `VITE_API_BASE_URL`. Locally: `.env`.
- The app then calls `${VITE_API_BASE_URL}/api/ai-chat`, the same path the website uses. Without it the AI screens show "not set up for the Android app yet".
- **Possible existing problem, please check:** the docs say the site is on Netlify, but `netlify.toml` has no `/api/*` -> function rewrite (the function's default Netlify address is `/.netlify/functions/ai-chat`), and `/*` is rewritten to `index.html`. The repo also has a Vercel-style `api/ai-chat.js`. Run `curl -i "https://YOUR-SITE/api/ai-chat?status=1"`: you should get JSON. If you get HTML, the website AI is not reachable at that path either, and a routing fix (an approved change to `netlify.toml`) is needed before Android AI can work. The author did not change deployed routing.
- Provider keys (`GEMINI_API_KEY` etc.) stay server-side. Never create a `VITE_` variable for them.

## 5. CORS (backend change, NOT deployed by the author)
`netlify/lib/ai/cors.js`, applied around the unchanged handler in `netlify/functions/ai-chat.js` (and therefore also `api/ai-chat.js`):
- Allowed origin: **exactly `https://localhost`** (Capacitor with `androidScheme: 'https'`, the default hostname). No wildcard, no credentials header.
- `OPTIONS` preflight from that origin -> 204 with `Access-Control-Allow-Origin: https://localhost`, headers `authorization, content-type`, methods `GET, POST, OPTIONS`. Any other origin -> no CORS headers (403 on preflight).
- The website sends no `Origin` for same-origin calls, so it is untouched. The bearer-token check, daily AI limit and server-side keys are unchanged.
- **This only takes effect when you redeploy the backend.** Verify the real origin: with the APK connected to Chrome DevTools (`chrome://inspect`), check `location.origin` is `https://localhost`. If it differs, `ALLOWED_ORIGINS` must be changed.

## 6. Local notifications
- Reminders are turned into one-shot Android alarms (`src/lib/reminderSchedule.js`, `src/native/localNotifications.js`). Android holds them, so they can fire with the app closed and no internet **when the phone allows it** (see limits).
- Time zone: the device's local date and time. **No time set -> 09:00 local.** Past times are skipped (never fired late). Done reminders are not scheduled.
- Repeats (daily, weekly, monthly, every N days) are expanded with the same `addInterval` rule the app uses.
- Rolling window: next **30 days**, at most **14 alarms per reminder**, **64 in total** (earliest first). The window is rebuilt on app start, app resume, when connectivity returns, after every reminder change, and after each sync. A far-future reminder starts alarming once it enters the window, which happens the next time the app is opened. **If the app is never opened, alarms stop when the window runs out.**
- Stable IDs derived from the reminder id (range 1,000,000,000+); a rebuild cancels and recreates only reminder alarms, so there are no duplicates and other notification kinds are untouched.
- Permission: asked only from the button in Notifications. If denied, nothing is scheduled, existing reminder alarms are removed, and the app keeps working; the card explains how to enable it in Android Settings.
- Tap a notification -> opens `/reminders?focus=<id>` (the id is validated as a UUID; anything else opens the plain Reminders list).
- The website keeps its original in-browser notifications; they are switched off on Android to avoid double alerts.
- **Honest limits (unverified until device-tested):** battery savers and manufacturer task killers (Xiaomi, Tecno, Infinix, Samsung, Huawei...) can delay or drop alarms. "Force stop" cancels alarms until the app is opened again. Without the exact-alarm permission Android may deliver minutes late. **Reboot:** the plugin is documented to restore its alarms after boot (`RECEIVE_BOOT_COMPLETED`), but this was not tested; the app also rebuilds them the next time it opens. **Time-zone change:** an Android alarm is a fixed moment, so after travelling it may fire at the old wall-clock time until the app is next opened and rebuilds the alarms. Do not rely on exact delivery on every phone until you have tested yours.

## 7. Offline reminders
Scope: **reminders only** (the rest of the app still needs a connection).
- The Reminders screen on Android reads/writes a local IndexedDB copy (`life-os-offline` v2), namespaced by your user id, and syncs with Supabase. The website still talks to Supabase directly.
- One queued change per reminder (create / update / delete), merged on repeat edits. New reminders get a client-generated UUID, so a retry after a lost reply finds the row instead of duplicating it.
- Retries: network/server errors retry with backoff 30 s, 1 m, 2 m... (max 15 m), up to 6 attempts, then "Could not save" with Retry / Discard. Validation/security errors fail immediately. An expired login pauses sync without using attempts. Requests have a real 15 s timeout (a timed-out request may still reach the server; retry is safe because it is idempotent).
- Repeat reminders: "done for now" moves the date once, on the device, exactly like the website, and that single update is what syncs.
- Conflicts: changes are merged field by field; a field changed elsewhere after your edit started is **not** overwritten (server wins; you see a notice). Editing a reminder deleted elsewhere does not bring it back.
- Sign-out: tries to send waiting changes (4 s max), removes your cached copy and alarms, **keeps unsent changes** for your next sign-in. Switching accounts never shows or sends the other account's data. Deleting the account removes everything it left on the phone.
- Not done: soft delete, background sync while the app is closed, other tables offline, cross-device merge beyond the rules above. Local IndexedDB can be cleared by Android under storage pressure.

## 8. Build and install a debug APK
Requirements: Node 20+, JDK 21, Android SDK, USB debugging on the phone.
```
npm install                       # also commit the generated package-lock.json
cp .env.example .env              # set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (and VITE_API_BASE_URL if known)
npm test
npm run cap:add:android           # first time only
npm run android:debug             # builds web, cap sync, patches manifest, gradlew assembleDebug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```
Or GitHub: Actions -> "Android debug APK" -> Run workflow (branch `Android-V1`), download the artifact. Secrets: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Variable: `VITE_API_BASE_URL`. No signing secrets exist; the APK is an unsigned debug build. Uninstall the earlier debug APK first if install reports a signature conflict.

## 9. Test with an existing account (on the phone)
1. Sign in with an existing email/password. Your existing reminders, tasks etc. must appear.
2. Sign out and in again; the session should restore after closing the app.
3. Password reset: Forgot password -> open the email on the phone -> link opens the app on "Choose a new password" (needs section 3).
4. AI Assistant: open it; send "hello". If it says "not set up", section 4 is not done. If it fails with a network error, check section 5 (CORS redeployed?) and `curl` the endpoint.

## 10. Test without internet
1. Open Reminders while online (fills the local copy). Turn on airplane mode.
2. Reminders still list. Create one, edit one, tick one done, delete one. Each shows "Waiting to sync".
3. Turn the network back on. Within seconds (or when you reopen the app) the banner clears; confirm on the website that the changes arrived and nothing is duplicated.
4. Offline notification: with notifications on, create a reminder for 2 minutes ahead in airplane mode, swipe the app away, wait. Record whether it fired and how late.

## 11. Test notification permission denial
Fresh install -> Notifications -> "Turn on device notifications" -> tap **Don't allow**. Expected: message "Permission was not granted...", the toggle stays off, nothing crashes, reminders still work in-app. Then Android Settings -> Apps -> Personal Life OS -> Notifications to allow; reopen the app; turn it on. Also test: allowed but exact alarms off (Android 14) shows the "Allow exact times" button.

## 12. Confirm Web V4 still works
Run `npm test` and `npm run build`, deploy to a **preview**, then in a desktop browser: sign in, open every page, add/edit/complete/delete a reminder, check the service worker still registers (DevTools -> Application), install prompt still works, in-browser notification card still appears under Notifications, password reset email still returns to the website, AI behaves as before. The Android code does not run in a browser (`isNativePlatform()` is false).

## 13. Known limitations and risks
See the final Phase 2 report. Short list: no real build or device test yet; no lockfile; exact-alarm and OEM battery behavior unverified; AI on Android depends on owner actions (sections 3-5); offline covers reminders only; the manifest patch was written against the Capacitor 7 template from its known structure, not a freshly generated file (the script fails loudly if the template differs).
