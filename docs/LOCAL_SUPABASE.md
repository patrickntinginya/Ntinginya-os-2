# Isolated local Supabase testing

This setup uses the Supabase CLI and Docker on this machine only. It does not need
`supabase login` or `supabase link`. Never use production URLs or credentials here.

## Requirements

- Node.js 20 or later
- Docker running locally
- The project-pinned CLI: `npx supabase --version`

The CLI is pinned in `package.json` and `package-lock.json`. The local project
configuration is `supabase/config.toml`; its project ID is `ntinginya-v6-local`.
Default local endpoints are:

- Supabase API/Auth/Storage: `http://127.0.0.1:54321`
- PostgreSQL: `127.0.0.1:54322`
- Studio: `http://127.0.0.1:54323`
- Mailpit: `http://127.0.0.1:54324`
- Vite app: `http://127.0.0.1:5173`

## Start local services

From the repository root:

```sh
npx supabase start
```

This starts the local Supabase services. When initializing a fresh local
database, the CLI can apply the repository's project migrations as part of
startup; do not assume that `supabase start` is migration-free. In this
workspace, the observed startup applied migrations 001–017 to the local
database and then exited with code 1. This was not a successful full-stack
startup: Studio was not available at the last inspection. That startup is
separate from the disposable PostgreSQL validation described in
[DATABASE_VALIDATION.md](./DATABASE_VALIDATION.md). Migration 018 was added
after that observed startup; it is validated by the disposable harness, and
the earlier CLI startup is not evidence that migration 018 was applied to
that local stack. The config disables seeds; no seed data or test accounts
are present.

To reset the local database and apply the repository's migrations, the separate
command is:

```sh
npx supabase db reset --no-seed
```

`db reset` is destructive to the local database: it recreates the database and
replays migrations. Run it only when explicitly authorized and when local data
may be discarded. Do not use `--remote`.

The first start downloads local Docker images. CLI output includes local
credentials. Keep them private. When authorized to start, configure the ignored
`.env.local` with the local API URL and only the local publishable/anon key:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<local-publishable-or-anon-key>
```

Never put the local service-role/secret key in a `VITE_` variable, source file,
Git, or chat. Then start Vite on loopback only:

```sh
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173`. Do not substitute any hosted project URL/key.

## Stop

Stop only this local project:

```sh
npx supabase stop
```

Do not pass `--all` or `--no-backup`; those options affect other local stacks
or remove local database volumes. Stopping normally preserves the local data.

## Migration and account boundary

Local service startup can apply migrations when it initializes the database.
The explicit `db reset` command additionally resets/recreates the local
database before replaying migrations. Do not run database reset, migration
commands, or `--remote` commands without separate authorization.

No test users have been created. A later test setup needs three distinct local
Auth users (regular, professional, and admin). Admin authorization must use
trusted `app_metadata.role = "admin"` set only through a local administrative
mechanism, never user-editable metadata. Do not use hosted accounts.
