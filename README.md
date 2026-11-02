# Personal Life OS - V4

One system for time, tasks, goals, projects, money, learning, notes, ideas and habits. React + Vite + Tailwind +
Supabase (auth, Postgres, Row Level Security) + PWA on Netlify. Money is in **Tanzanian Shillings** (stored as numeric,
shown as `TSh 1,500,000`). The interface is available in **Kiswahili and English**.

> **Verification status.** Written without access to the npm registry or a database. **Run so far:** `npm test`
> (168 tests, all passing) and a script that checks every file parses and every import resolves. **Not run yet:**
> `npm install`, `npm run build`, `npm run preview`, a Netlify deploy, a real Gemini call, the PWA install, and any screen
> in a browser. Do those first (docs/V4_SETUP.md). V4 is **not** declared complete until they pass.

## What V4 added
- Kiswahili / English switch (top bar, sidebar, login screens), Kiswahili by default, saved on the device.
- A highlighted **AI Assistant** entry in the sidebar and the phone bottom bar.
- **Gemini** as the default AI provider (server-side only), with a provider layer that still supports Anthropic, OpenAI and Ollama.
- Settings -> AI: provider, model, daily limit, status, on/off, Test connection. Friendly quota/timeout/server errors in both languages.
- Language-aware AI answers; bilingual offline message; accessibility and touch-target tests.

## Everything from V3 and V2 is kept
Life Score, daily briefing, habits, Today/Planner/Schedule, tasks, goals -> projects -> tasks, finance (budgets, savings, recurring,
forecast, "Can I afford this?"), notes, ideas, learning, search, notifications (in-app), reviews, insights, data export, account deletion.
All of these work **without AI**.

## Architecture
```
src/i18n/                    en.js, sw.js (keyed text), sw.phrases.js (Kiswahili for English phrases), I18nContext
src/pages, components        UI (mobile-first); src/utils = pure, tested calculation code
api/ai-chat.js (+ api/_lib/ai/) the only server code: verifies the user, builds a data summary, calls the provider
netlify/lib/ai/providers/    gemini (default), anthropic, openai, ollama
supabase/migrations/001-003  schema (no V4 migration);  supabase/tests/rls_isolation.sql
tests/                       node --test
```

## Environment variables
| Variable | Where | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | browser | Supabase project (anon key only) |
| `AI_PROVIDER` | server | `gemini` (default), `anthropic`, `openai`, `ollama`, `none` |
| `GEMINI_API_KEY` | server | Google Gemini key. Never `VITE_`-prefixed |
| `GEMINI_MODEL` | server | optional model ID; default `gemini-3.1-flash-lite` (see docs for caveat) |
| `AI_MAX_TOKENS`, `AI_DAILY_LIMIT` | server | optional output and per-user daily limits |
| `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL` | server | only for the other providers |

## Setup, deploy, PWA
See **docs/V4_SETUP.md** (beginner guide). Deploy to your existing Netlify site: push the code, add the variables, redeploy. No new site and no new migration.
Install on Android from Chrome: menu -> Install app. Only the app shell is cached; data needs internet. It is a PWA, not an APK.

## AI and no-AI mode
Without `GEMINI_API_KEY` the app does not crash: AI screens say "AI haijaunganishwa" / "AI not configured" and every rule-based feature keeps working. No fake AI answers are ever shown.
The AI can only **propose** actions; each needs your **Confirm**, and it cannot delete data, move money or send messages.
Gemini use is "subject to Google's current API quotas and pricing"; nothing here promises free or unlimited AI.

## Security
Row Level Security on every user table; a database trigger blocks links to another user's records; the AI function uses the caller's own token;
no service-role key exists in the project; the Gemini key is read only in server provider code and sent in a request header, never to the browser;
tests scan the code for VITE_ AI variables and key patterns.

## Testing
`npm test` runs 168 tests, including: Kiswahili/English catalogues and placeholder parity, every UI phrase translated, language persistence,
AI button visibility, Gemini selection / missing key / errors / rate limits, AI action safety, secret protection, mobile navigation and PWA configuration.
Database isolation must be tested by you with `supabase/tests/rls_isolation.sql`.

## Known limitations
- Not built, deployed or run in the authoring environment (see top).
- The language choice is per device (browser storage), not per account.
- Kiswahili wording was written without native-speaker review; please proofread `src/i18n/`.
- The default Gemini model ID comes from Google's current documentation and may change; set `GEMINI_MODEL` if needed.
- Netlify's default function timeout may be shorter than the 24 s the function waits for Gemini.
- No push notifications (in-app only; device alerts only while the app is open). No lint tool is configured.
- Dynamic user content (your own task titles, notes, names) is shown exactly as you typed it, not translated.
