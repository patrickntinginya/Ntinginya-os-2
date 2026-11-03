# Database validation (migrations 001–018)

**Latest recorded isolated SQL result: 222 PASS, 0 FAIL.** The disposable local
PostgreSQL validation harness applied migrations 001–018 and ran its listed
SQL checks. It did not connect to a Supabase project. This is a recorded
historical result; this documentation update did not rerun it.

```bash
./scripts/verify-db.sh
```

The script requires a local Docker Unix socket, creates a disposable
`postgres:16` container, and refuses configured external database URLs and
remote Docker endpoints. It loads `supabase/tests/local_bootstrap.sql`
(stand-ins for Supabase Auth/Storage schemas and roles), applies all
`supabase/migrations/*.sql` files in numeric order (001–018), and runs:
`rls_isolation.sql`, `slice1_rls.sql`, `chat_rls.sql`,
`voice_upload_guards.sql`, `ai_usage_limits.sql`, and `marketplace_rls.sql`.
The validation result covers this isolated harness, not Supabase's hosted
services. Do not run `local_bootstrap.sql` against a Supabase project.

## Migration order and compatibility notes

Migrations are applied in order: 001 → 002 → 003 → 004 → 005 → 006 → 007 →
008 → 009 → 010 → 011 → 012 → 013 → 014 → 015 → 016 → 017 → 018. Existing migration
files are retained; later migrations add to or harden the schema. Notable
dependencies and changes include:

- 009 follows 006 and 007 and replaces the DO IT / snooze function signatures.
  Deploy compatible application code together with that migration; older code
  calls the previous signatures.
- 010 uses Community objects from 007 and notification columns from 006.
- 011 replaces the attachment-read function from 010 and adds voice limits;
  012 depends on the chat/voice objects and `storage.objects`.
- 013 depends on 007 and 010–011; 014 guards comment retargeting.
- 015 fixes table-specific trigger-field access and validates stored voice
  metadata; 016 adds database-backed AI usage limits; 017 adds the
  Professionals Marketplace and appointments schema.
- 018 changes the appointment-to-professional foreign key to `ON DELETE
  RESTRICT`. A professional account cannot be deleted while appointment
  records refer to it, preserving the clients' appointment history. This
  migration does not delete or rewrite appointment records.

## Scope and limitations

- The bootstrap imitates selected Supabase database objects; it is not
  Supabase. The SQL result does not verify Supabase Auth, Storage, Realtime,
  REST, or Studio behavior.
- `voice_upload_guards.sql` exercises the local Storage stand-in with valid and
  invalid metadata. It does not prove real Supabase Storage metadata behavior.
- `ai_usage_limits.sql` tests daily and burst limits, per-user independence,
  and anonymous-role denial against the local PostgreSQL harness.
- Migration 012's `chat_media_unattached` view and
  `scripts/cleanup-chat-media.mjs` require the service role on a real project;
  use a disposable project and dry-run first.
- Real Storage DELETE behavior needs read access; see the "Deleted messages"
  section of [VOICE.md](./VOICE.md).
- Browser, Android-device, and hosted Supabase/production testing have not
  been performed. No production database was accessed.
- Separately, a local `supabase start` attempt applied migrations 001–017 to
  the local Supabase database but exited with code 1; Studio was absent at the
  last inspection. This is not the successful disposable PostgreSQL harness
  result. Migration 018 was added afterward and is covered by the disposable
  harness result; the earlier CLI startup is not evidence that 018 was applied
  to that local stack. See [LOCAL_SUPABASE.md](./LOCAL_SUPABASE.md).

## Decisions that need the business owner
- **Private groups are discoverable** (name and description visible to members so they can ask to join); everything inside is members-only. If you prefer private groups to be invisible, join-by-invite-code is required (not built).
- Group member counts show 0 to non-members of public groups (a count under RLS). Cosmetic; can be changed with a counting function.

## Realtime is not part of the local bootstrap
`local_bootstrap.sql` has no `realtime` schema or `supabase_realtime` publication. Migration 010 guards those statements, so it applies, but **the Realtime
policies are therefore NOT exercised** by `verify-db.sh`. Test live delivery, typing and presence on a disposable Supabase project.
