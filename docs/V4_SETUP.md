# Personal Life OS V4 - Setup Guide (for beginners)

V4 is an upgrade of V3. You keep the same Netlify site, domain and Supabase project. **V4 has no new database migration**,
so nothing in Supabase has to be changed or re-run.

> **Honest status:** V4 was written in an environment with **no access to the npm registry and no database**, so these have
> **not been run yet**: `npm install`, `npm run build`, `npm run preview`, the Netlify deployment, a real Gemini call, the PWA
> install, and any screen in a real browser. What *was* run: `npm test` (168 tests, all passing) and a script that checks every
> file parses and every import resolves. Treat each step below as a real test.

## 1. What is new in V4
- **Kiswahili and English.** A `🇹🇿 SW | 🇬🇧 EN` switch is in the top bar on phones, at the top of the sidebar on computers, and on the login screens. Kiswahili is the default for first-time users. Your choice is saved **on this device** (browser storage), so it survives refresh, logout/login and reopening the app. A different phone or browser needs its own choice (nothing is added to the database).
- **AI Assistant is easy to find.** It has its own highlighted item in the sidebar ("Msaidizi wa AI" / "AI Assistant") and a button in the phone bottom bar.
- **Gemini is the default AI provider**, called only from the Netlify function. The app works fully without it.
- **Settings -> AI** shows provider, model, daily limit and status, has an on/off switch and a **Test connection** button. It never shows the key.
- **Friendly AI errors** in both languages: quota/rate limit, timeout, server error, not configured, turned off.
- The AI answers in the language of the interface; you can also type in either language.

## 2. Update the code
```bash
npm install
npm test          # should show: pass 168, fail 0
npm run build     # should finish without errors
```
There is no lint tool configured, so there is no `npm run lint`.

## 3. Supabase
Nothing new. If this is a brand-new project, run `001_v1_foundation.sql`, `002_v2.sql`, `003_v3.sql` (in that order) in the SQL editor, then run `supabase/tests/rls_isolation.sql` and expect `ALL CHECKS PASSED`.

## 4. Get a Gemini key (optional)
1. Open Google AI Studio (https://aistudio.google.com) and create an API key.
2. Keep it secret. Never paste it in the app code, in GitHub, or in a variable that starts with `VITE_`.
3. Gemini is **subject to Google's current API quotas and pricing**. Free allowances can change or end; check Google's pricing page. This app does not promise free or unlimited AI, and `AI_DAILY_LIMIT` caps each user.

## 5. Netlify environment variables
Netlify -> your existing site -> **Site configuration -> Environment variables**. Add:

| Name | Needed? | Meaning |
|---|---|---|
| `VITE_SUPABASE_URL` | yes (already set) | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | yes (already set) | anon public key only |
| `AI_PROVIDER` | optional | `gemini` (default), `anthropic`, `openai`, `ollama`, `none` |
| `GEMINI_API_KEY` | for AI | your Gemini key. **Server only** |
| `GEMINI_MODEL` | optional | a Gemini model ID from Google's list. Empty = the default `gemini-3.1-flash-lite` (a model ID listed in Google's Gemini API documentation when V4 was written; Google changes models over time, so if Settings -> Test connection reports an error, pick a current ID) |
| `AI_MAX_TOKENS` | optional | answer length limit, 64-4000, default 2048 for Gemini |
| `AI_DAILY_LIMIT` | optional | AI messages per user per 24 h, 1-1000, default 100 |

After saving, **redeploy** (Deploys -> Trigger deploy) so the function sees the new values.
Without `GEMINI_API_KEY` the AI screens say "AI haijaunganishwa" / "AI not configured" and everything else works.
For local work copy `.env.example` to `.env`. Run `npx netlify dev` (not `npm run dev`) if you want AI locally.

## 6. Deploy to your existing Netlify site
Push the updated code to the GitHub repository the site is connected to. Netlify rebuilds (`npm run build`, publish `dist`, functions `netlify/functions` - already in `netlify.toml`, unchanged in shape). Do **not** create a new site. Your domain and settings stay.

## 7. How the AI works and its limits
`Browser -> Netlify function (ai-chat) -> Gemini -> validated reply -> app`.
- The function verifies your Supabase login, reads **your** data with your own token (so Row Level Security applies), builds a short summary (not the whole database), and calls Gemini with the key it holds.
- The AI can only **propose** actions (task, reminder, event, goal, project, idea, learning item, milestone). Each appears as a card with **Confirm** / **Cancel**. Nothing is saved until you press Confirm. It cannot delete anything, move money or send messages.
- Limits: a per-minute burst limit and a daily limit per user. When Google reports a quota problem you see: "Matumizi ya AI kwa sasa yamefikia kikomo. Tafadhali jaribu baadaye." / "Your AI usage limit has been reached. Please try again later."
- The function waits up to 24 seconds for Gemini. Netlify's default function timeout can be shorter (often 10 s on the free plan); a timeout shows "AI took too long to answer".
- Google calls this API (`generateContent`) the legacy API but states it remains fully supported; the app uses it.
- Financial comments are general guidance, not professional financial advice.

## 8. PWA (install on Android)
Open the site in Chrome -> menu -> **Install app**. It opens full screen with the Life OS icon. Only the app shell is cached. When offline you see "Uko offline" / "You're offline" and your data needs internet. There is no offline editing. This is a PWA, not an APK.

## 9. Manual test checklist
1. Open the site. Tap **EN**, then **SW**: every screen changes. Refresh, log out, log in: the language is kept.
2. Find the AI button (bottom bar on phone, sidebar on computer). Open it.
3. Settings -> AI: provider Gemini, a model, daily limit, status. Press **Test connection**.
4. Ask in Kiswahili: "Nipangie siku yangu." and in English: "What should I focus on today?"
5. Ask the AI to create a task: confirm a **Confirm/Cancel** card appears and nothing exists until you confirm.
6. Turn **Use AI features** off: the rest of the app keeps working. Remove `GEMINI_API_KEY` in a test deploy: AI says "not configured", Life Score, finance, briefing, reviews and planner still work.
7. Check a second account cannot see the first account's data (RLS).
8. Install the PWA on Android; switch airplane mode on and look for the offline message.

## 10. Troubleshooting
- "AI haijaunganishwa" / "not configured": set `GEMINI_API_KEY` in Netlify and redeploy.
- "The AI service is not set up correctly": the key or model is wrong. Check `GEMINI_MODEL` against Google's current list.
- "not available here" locally: use `npx netlify dev`.
- Wrong or odd Kiswahili: the wording was written without a native-speaker review. Please proofread `src/i18n/sw.js` and `src/i18n/sw.phrases.js`.
