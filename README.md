# Ntinginya Life Ecosystem V6

Ntinginya Life Ecosystem is a React single-page application built with Vite,
Supabase, and Capacitor. It brings personal planning and community features
together in a responsive web interface with an Android app shell.

## Project features

- Authentication and user profiles using the existing Supabase Auth setup.
- Dashboard, tasks, reminders, habits, goals, finance, and notification tools.
- Community posts, groups, comments, reactions, and moderation.
- Live chat, voice messages, and an offline media library.
- Safe Mode media restrictions and in-app YouTube playback.
- Professionals Marketplace, service listings, free appointment requests, and
  administrative review workflows. Payments, commissions, and payouts are not
  part of the current booking flow.
- AI chat through the server-side provider router, including Gemini and
  OpenRouter configuration and failover.
- English and Kiswahili translations.

## Architecture

- `src/`: React UI, routes, layouts, services, hooks, and translations.
- `api/`: server-side AI API and provider routing.
- `supabase/migrations/`: additive database migrations, currently numbered
  001–018.
- `supabase/tests/`: SQL checks for database permissions and feature rules.
- `tests/`: Node.js automated tests.
- `android/` and Capacitor configuration: Android app integration.

The browser client uses the shared Supabase client in `src/lib/supabase.js`.
AI provider credentials belong in the server environment and must not be
exposed through client-side `VITE_` variables.

## Local development

Install dependencies using the repository lockfile, then run:

```sh
npm run dev
```

For isolated local Supabase setup, requirements, service URLs, and migration
behavior, see [docs/LOCAL_SUPABASE.md](docs/LOCAL_SUPABASE.md). Supabase CLI
startup can apply project migrations when initializing its local database; do
not assume that `supabase start` is migration-free.

## Verification status

Recorded automated results (not rerun as part of this documentation update):

- The last recorded full JavaScript test run passed **575 tests**. A later
  focused date/time regression run passed **10/10**; the full suite was not
  rerun after that additional test.
- Focused Marketplace tests passed **15/15**.
- A focused Community, Live Chat, Voice Messages, Offline Media, and Safe Mode
  run passed **143/143**.
- The production build passed in the latest recorded integration verification.
- The isolated disposable PostgreSQL harness applied migrations **001–018**
  and reported **222 PASS, 0 FAIL**. This harness uses PostgreSQL with local
  Supabase stand-ins; it is not a hosted Supabase test.
- Migration 018 changes the professional reference on appointments to
  `ON DELETE RESTRICT`, preventing deletion of a professional account while
  appointment records still reference it.

These results are separate runs and should not be added together. The local
Supabase CLI startup is a separate outcome: it applied migrations 001–017 to
the local database but exited with code 1, and Studio was not available at the
last inspection. The successful disposable PostgreSQL harness does not mean
that the CLI stack startup succeeded.

**Outstanding verification:** interactive browser testing, physical Android
device testing, and hosted Supabase/production behavior. No production
deployment or production database verification is claimed.

For detailed database-test scope and limitations, see
[docs/DATABASE_VALIDATION.md](docs/DATABASE_VALIDATION.md). For the Community
and Smart Action Center implementation notes, see [docs/SLICE1.md](docs/SLICE1.md).
