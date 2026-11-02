# AI setup: Gemini (primary) + OpenRouter (secondary) with automatic failover

All AI calls run on the server (`api/ai-chat.js`, code in `api/_lib/ai/`). Keys live only in Vercel environment variables.
Never add a `VITE_` prefix to them: `VITE_` values are copied into the public website.

## 1. Gemini
1. Create a key in Google AI Studio.
2. Vercel -> Project -> Settings -> Environment Variables: `GEMINI_API_KEY`. Optional `GEMINI_MODEL` (empty = built-in default, with one retry on a widely available model if the default is rejected).
3. Redeploy. Quotas and pricing are Google's current terms; nothing here promises free or unlimited use.

## 2. OpenRouter
1. Create a key at https://openrouter.ai/keys.
2. Set `OPENROUTER_API_KEY` **and** `OPENROUTER_MODEL` in Vercel, then redeploy.
3. There is **no default model on purpose**: free model IDs change and could not be verified when this was written. Copy a current ID from https://openrouter.ai/models (free ones end in `:free`). Without `OPENROUTER_MODEL` the provider is reported as "not configured" instead of guessing.
4. To change the model later: edit `OPENROUTER_MODEL` in Vercel and redeploy. No source edit.
5. Free models can be removed or rate limited at any time. If the model disappears, requests to OpenRouter fail with a configuration error, the provider enters a cool-down, and automatic mode keeps using Gemini.

The OpenRouter address is fixed in code; no request field, browser value or environment variable can redirect it.

## 3. Choosing a provider (users)
Settings -> AI settings -> **AI service**. The list appears only when the server reports more than one configured provider, and only configured providers are listed.
- **Automatic**: Gemini first, OpenRouter as backup. The chat shows "Answered by ... because the first AI service was unavailable" when the backup answered.
- **Gemini** / **OpenRouter**: only that provider is used. A failure is shown as an error; the app never silently switches.
The choice is a preference stored in the browser and sent with each request. The server validates it; unknown values mean Automatic. It cannot choose a URL or a model.

## 4. How failover works (automatic mode)
Per request, with one overall deadline (default 22 s, hard cap 27 s, under the 30 s `maxDuration`):
1. Try the primary provider (a provider in cool-down is skipped).
2. Transient failures (timeout, network error, HTTP 429, 5xx, malformed/empty reply) get at most `AI_MAX_RETRIES` (default 1) extra tries on the same provider, with exponential backoff and jitter. A timeout is not retried when a backup exists: that time goes to the backup.
3. `Retry-After` is honoured only if it is <= 5 s and the deadline allows. A 429 without it fails over immediately.
4. Authentication, permission, unknown-model and bad-request errors are **never retried**. In automatic mode they still allow the backup (a bad Gemini key must not take the assistant down while OpenRouter works).
5. The backup gets the same system prompt, the same conversation history and the same language. Text from the two providers is never combined.
6. Nothing is written to the database until one complete, validated answer exists, so a retry or switch cannot duplicate a stored message or an action proposal. If both fail, the user gets a safe error with a `request_id`, nothing is stored, and the page keeps the question in the input box.
7. No attempt starts if less than 2.5 s remain.

Streaming: the current transport is **not** streaming, so no partial text can reach the browser. The router already has a `partialSent()` guard: if streaming is added later, a failure after the first byte is surfaced instead of retried or switched (otherwise the answer would be restarted or spliced).

Cancellation: the router stops and does not try the other provider if the request signal aborts. On Vercel's Node adapter a client disconnect does not abort the request signal, so cancellation is best-effort there.

## 5. Health monitor and cool-down
Per provider: status, consecutive failures, last success, recent latency, rate-limit state, cool-down. After 3 consecutive transient failures a provider is skipped for 30 s, doubling to a 5 minute ceiling. Auth/model/config errors cool down for 5 minutes. When a cool-down ends, **one** probe request is allowed through; success restores the provider, failure starts the next bounded cool-down. Nothing is disabled permanently.
**Limitation:** this state lives in the memory of one serverless instance. Instances do not share it, and a cold instance starts "healthy". It is an optimisation, not a source of truth.

## 6. Diagnostics (administrators)
`GET /api/ai-chat?diagnostics=1` with the user's bearer token. The server verifies the token with Supabase and requires `app_metadata.role` of `admin` or `owner` (the same rule as `safe_mode_is_admin()` in the database). `user_metadata` is user-editable and is **not** trusted. Others get 401/403.
To make an administrator, set `app_metadata` `{"role":"admin"}` from the Supabase dashboard or with the service role on your own machine; the app has no screen or API that can do this.
It returns counters, timings, status and the last 50 routing events (provider, model, outcome, failure category, fallback flag, duration, correlation id). No keys, prompts or answers. Administrators see it in Settings -> AI settings.
Server logs carry the same fields as one JSON line per attempt (`evt: "ai_route"`), plus the correlation id that the user sees in `request_id`.

## 7. Testing missing or invalid keys
- Unset `OPENROUTER_API_KEY`: the provider is not listed, the picker disappears, Gemini serves alone.
- Unset `GEMINI_API_KEY` but keep OpenRouter: OpenRouter serves.
- Put a wrong Gemini key: the first request tries Gemini once, then OpenRouter answers; later requests skip Gemini for 5 minutes, then probe it once.
- Settings -> AI -> **Test connection** makes one attempt per provider (no retries) and reports the real result.
- Automated: `npm test` (`tests/ai-router.test.js`, `tests/ai-failover-e2e.test.js`) uses mocks; it never calls a paid or real API.

## 8. Not covered
DeepSeek is not implemented. The router takes providers from a small registry (`api/_lib/ai/provider.js`), so one can be added later without frontend changes. Nothing in this package should be read as saying a free DeepSeek API exists.
