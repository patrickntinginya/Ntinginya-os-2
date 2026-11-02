# Database validation (migrations 001-013 + RLS tests)

**Status in this delivery: NOT EXECUTED.** The build sandbox has no PostgreSQL and no network, so the SQL has only been checked statically
by `npm test`. Run the command below once, on your own machine, and record the output in `TEST_REPORT.md`.

```bash
./scripts/verify-db.sh        # needs Docker; starts a throwaway postgres:16, applies everything, runs the tests, removes the container
```
It applies `supabase/tests/local_bootstrap.sql` (stand-ins for Supabase's auth/storage schemas and roles), then migrations 001 to 009 in order,
then `rls_isolation.sql`, `slice1_rls.sql` and `chat_rls.sql`. It exits 0 only when every migration applies and no test prints `FAIL`.

Notes
- The bootstrap imitates Supabase; it is not Supabase. After a green local run, repeat the two test files in the SQL editor of a **disposable Supabase
  project** (never production). Storage policies in particular behave slightly differently on the real platform.
- Never run `local_bootstrap.sql` against a Supabase project.
- Migration order: 001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012 → 013 (011 replaces the attachment read function from 010 and adds the voice limits; 012 needs 010/011 and `storage.objects`; 013 needs 007 and 010–011; 009 must come after 006 and 007; 010 needs 007 for `community_profiles`, `community_blocks`, `community_is_admin()` and 006 for the notification columns).
- Applying 009 replaces the DO IT / snooze functions with new signatures. Deploy the new app version and migration 009 together: the previous app build calls the old signatures and DO IT would fail until it is updated.

## Decisions that need the business owner
- **Private groups are discoverable** (name and description visible to members so they can ask to join); everything inside is members-only. If you prefer private groups to be invisible, join-by-invite-code is required (not built).
- Group member counts show 0 to non-members of public groups (a count under RLS). Cosmetic; can be changed with a counting function.

## Realtime is not part of the local bootstrap
`local_bootstrap.sql` has no `realtime` schema or `supabase_realtime` publication. Migration 010 guards those statements, so it applies, but **the Realtime
policies are therefore NOT exercised** by `verify-db.sh`. Test live delivery, typing and presence on a disposable Supabase project.

## Things only a real project can show (not covered by the local bootstrap)
- 013's `voice_object_within_limits()` reads Storage's own object metadata (`size`, `mimetype`). The bootstrap's `storage.objects` has a `metadata` column but nothing fills it, so the trigger is not exercised for real.
- 012's view `chat_media_unattached` and `scripts/cleanup-chat-media.mjs` need the service role on a real project (dry run first).
- Storage's real DELETE behaviour (it needs read access): see the "Deleted messages" section of docs/VOICE.md.
