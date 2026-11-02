-- Ntinginya V6 / Slice 1 security corrections. Additive; run once after 008.
-- NOTE: statically checked by the project tests; NOT yet executed against a live Postgres (none was available in the build
-- environment). Execute supabase/tests/slice1_rls.sql against a disposable Supabase project / local Postgres before going live.
--
-- Contents
--   A. community-media Storage RLS: a signed URL (and any read) is only possible for media the caller may legitimately see.
--   B. Private-group rules stated explicitly (see the comment block) + index support.
--   C. Smart Action Center: server-issued claim ids, finish bound to the live claim and its audit row, audit table write-protected,
--      protected notification columns cannot be edited directly by a signed-in user.

-- =====================================================================================================================
-- A. community-media Storage policy
-- =====================================================================================================================
-- Before: ANY signed-in user could read ANY object in the bucket (and therefore mint a signed URL for it) if they knew or guessed
-- the path, including media of hidden posts, private groups and blocked members.
-- Now a member may read an object only if one of these is true:
--   1. it is in their own folder (their uploads, including ones not yet attached to a post);
--   2. they are an administrator (app_metadata.role, never user_metadata);
--   3. it is the media of a post they are allowed to see (same rules as community_posts_select):
--        visible post, author not blocked either way, and the post is public-profile (no group), or in a public active group,
--        or the caller is an ACTIVE member of the group;
--   4. it is the avatar of an active member who is not blocked either way.
-- Suspended groups hide their media from non-members. Hidden/removed posts hide their media from everyone except author and admin.
create or replace function public.community_can_read_media(obj_name text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select
    auth.uid() is not null and (
      (storage.foldername(obj_name))[1] = auth.uid()::text
      or public.community_is_admin()
      or exists (
        select 1 from public.community_posts p
        where p.media_path = obj_name
          and p.status = 'visible'
          and not public.community_blocked(p.user_id)
          and (
            p.group_id is null
            or public.community_is_group_member(p.group_id)
            or exists (select 1 from public.community_groups g where g.id = p.group_id and g.privacy = 'public' and g.status = 'active')
          )
      )
      or exists (
        select 1 from public.community_profiles pr
        where pr.avatar_path = obj_name
          and pr.status = 'active'
          and not public.community_blocked(pr.user_id)
      )
    );
$$;
revoke all on function public.community_can_read_media(text) from public, anon;
grant execute on function public.community_can_read_media(text) to authenticated;

create index if not exists community_posts_media_idx on public.community_posts (media_path) where media_path is not null;
create index if not exists community_profiles_avatar_idx on public.community_profiles (avatar_path) where avatar_path is not null;

drop policy if exists community_media_select on storage.objects;
create policy community_media_select on storage.objects for select to authenticated
  using (bucket_id = 'community-media' and public.community_can_read_media(name));

-- =====================================================================================================================
-- B. Private groups - the single rule used by the database, the screens and the tests
-- =====================================================================================================================
--  * A private group is DISCOVERABLE: its name and description are visible to every signed-in member so they can ask to join.
--    (community_groups_select is unchanged on purpose.)
--  * Everything INSIDE it is members-only: posts, comments, reactions, the member list and all attached media are visible only to
--    ACTIVE members of that group (and administrators). A pending requester sees nothing but their own request.
--  * Joining a private group creates a 'pending' request; only the group owner/moderators or an administrator can accept it.
--  * A blocked member's content is hidden from the blocker in both directions, inside groups too.
comment on table public.community_groups is 'Private groups are discoverable by name/description; their content is members-only (see 009).';

-- =====================================================================================================================
-- C. Smart Action Center hardening
-- =====================================================================================================================
alter table public.notifications add column if not exists action_claim_id uuid;
alter table public.notification_actions add column if not exists claim_id uuid;
create index if not exists notification_actions_claim_idx on public.notification_actions (claim_id) where claim_id is not null;

-- The audit table is written ONLY by the functions below. A signed-in user can read their own rows, nothing else.
drop policy if exists notification_actions_insert_own on public.notification_actions;
drop policy if exists notification_actions_update_own on public.notification_actions;
drop policy if exists notification_actions_delete_own on public.notification_actions;
revoke all on table public.notification_actions from authenticated, anon;
grant select on table public.notification_actions to authenticated;

-- A signed-in user may mark their own notifications read/unread and delete them. Everything that decides what DO IT / snooze do
-- (status, claim, snooze, action kind/target, due time, result) can only be changed by the functions below.
-- Inside a SECURITY DEFINER function current_user is the function owner, so only direct client writes (role 'authenticated'/'anon') are blocked.
create or replace function public.notification_guard()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if current_user in ('authenticated', 'anon') then
    if (to_jsonb(new) - 'is_read' - 'updated_at') is distinct from (to_jsonb(old) - 'is_read' - 'updated_at') then
      raise exception 'notification_protected';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists notifications_guard on public.notifications;
create trigger notifications_guard before update on public.notifications for each row execute function public.notification_guard();

-- The old signatures are replaced, not overloaded, so the weaker versions cannot be called any more.
drop function if exists public.notification_begin_action(uuid, text);
drop function if exists public.notification_finish_action(uuid, text, boolean, text);
drop function if exists public.notification_snooze(uuid, text);
drop function if exists public.notification_wake_due();

-- Claim a notification for execution. Returns a fresh claim_id that only THIS claim holds.
create or replace function public.notification_begin_action(p_notification uuid, p_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n public.notifications; uid uuid := auth.uid(); k text; cid uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_key is null or char_length(p_key) < 8 or char_length(p_key) > 100 then raise exception 'bad_key'; end if;
  k := p_key;
  select * into n from public.notifications where id = p_notification and user_id = uid for update;
  if not found then raise exception 'not_found'; end if;
  -- one key belongs to one notification: reusing it for another is rejected, never silently merged
  if exists (select 1 from public.notification_actions a where a.user_id = uid and a.idempotency_key = k and a.notification_id <> n.id) then
    raise exception 'key_reuse';
  end if;
  if n.status = 'done' then return jsonb_build_object('claimed', false, 'status', 'done', 'result', n.action_result); end if;
  if n.status = 'dismissed' then return jsonb_build_object('claimed', false, 'status', 'dismissed'); end if;
  if n.status = 'running' and n.action_started_at > now() - interval '2 minutes' then
    return jsonb_build_object('claimed', false, 'status', 'running');
  end if;
  cid := gen_random_uuid();
  insert into public.notification_actions (user_id, notification_id, action, idempotency_key, outcome, claim_id)
    values (uid, n.id, 'do_it', k, 'started', cid)
    on conflict (user_id, idempotency_key) do update
      set outcome = 'started', claim_id = excluded.claim_id, detail = null, updated_at = now()
      where public.notification_actions.notification_id = n.id and public.notification_actions.action = 'do_it';
  update public.notifications set status = 'running', action_started_at = now(), action_claim_id = cid, is_read = true where id = n.id;
  return jsonb_build_object('claimed', true, 'status', 'running', 'claim_id', cid, 'action_kind', n.action_kind, 'action_ref', n.action_ref, 'link', n.link);
end $$;

-- Finish a claim. Succeeds only for the CURRENT claim (matching claim_id on the notification AND on its audit row, outcome 'started').
-- A stale claim (re-claimed after the 2 minute timeout), a forged claim id, a different key or a different notification all raise.
create or replace function public.notification_finish_action(p_notification uuid, p_key text, p_claim uuid, p_ok boolean, p_result text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); n public.notifications; a public.notification_actions;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_claim is null or p_ok is null then raise exception 'bad_claim'; end if;
  select * into n from public.notifications where id = p_notification and user_id = uid for update;
  if not found then raise exception 'not_found'; end if;
  select * into a from public.notification_actions
    where user_id = uid and idempotency_key = p_key and notification_id = n.id and action = 'do_it' for update;
  if not found then raise exception 'no_audit_record'; end if;
  -- idempotent replay of a finish that already succeeded with this very claim
  if n.status = 'done' and a.claim_id = p_claim and a.outcome = 'succeeded' then
    return jsonb_build_object('status', 'done', 'replay', true);
  end if;
  if n.status <> 'running' or n.action_claim_id is distinct from p_claim or a.claim_id is distinct from p_claim or a.outcome <> 'started' then
    raise exception 'no_active_claim';
  end if;
  if p_ok then
    update public.notifications set status = 'done', executed_at = now(), action_result = left(coalesce(p_result, 'done'), 500),
      snoozed_until = null, action_claim_id = null, is_read = true where id = n.id;
  else
    update public.notifications set status = 'open', action_started_at = null, action_claim_id = null,
      action_result = left(coalesce(p_result, 'failed'), 500) where id = n.id;
  end if;
  update public.notification_actions set outcome = case when p_ok then 'succeeded' else 'failed' end, detail = left(p_result, 500) where id = a.id;
  return jsonb_build_object('status', case when p_ok then 'done' else 'open' end);
end $$;

-- REMIND ME AFTER 5M: server clock, fixed five minutes. A second press while a snooze is pending returns the same time.
create or replace function public.notification_snooze(p_notification uuid, p_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); n public.notifications; until_ts timestamptz;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_key is null or char_length(p_key) < 8 or char_length(p_key) > 100 then raise exception 'bad_key'; end if;
  select * into n from public.notifications where id = p_notification and user_id = uid for update;
  if not found then raise exception 'not_found'; end if;
  if exists (select 1 from public.notification_actions a where a.user_id = uid and a.idempotency_key = p_key and a.notification_id <> n.id) then
    raise exception 'key_reuse';
  end if;
  if n.status in ('done', 'dismissed') then return jsonb_build_object('snoozed', false, 'status', n.status); end if;
  if n.status = 'running' and n.action_started_at > now() - interval '2 minutes' then
    return jsonb_build_object('snoozed', false, 'status', 'running'); -- being executed right now: do not snooze underneath it
  end if;
  if n.snoozed_until is not null and n.snoozed_until > now() then
    return jsonb_build_object('snoozed', true, 'duplicate', true, 'snoozed_until', n.snoozed_until);
  end if;
  until_ts := now() + interval '5 minutes';
  update public.notifications set snoozed_until = until_ts, snooze_count = snooze_count + 1, is_read = true where id = n.id;
  insert into public.notification_actions (user_id, notification_id, action, idempotency_key, outcome, detail)
    values (uid, n.id, 'snooze', p_key, 'succeeded', until_ts::text)
    on conflict (user_id, idempotency_key) do nothing;
  return jsonb_build_object('snoozed', true, 'duplicate', false, 'snoozed_until', until_ts);
end $$;

-- Brings back snoozed notifications whose five minutes are over. Returns them once; the update clears snoozed_until, so a repeat returns nothing.
create or replace function public.notification_wake_due()
returns setof public.notifications language sql security definer set search_path = public, pg_temp as $$
  update public.notifications set snoozed_until = null, is_read = false, due_at = coalesce(due_at, now())
  where user_id = auth.uid() and status = 'open' and snoozed_until is not null and snoozed_until <= now()
  returning *;
$$;

revoke all on function public.notification_begin_action(uuid, text) from public, anon;
revoke all on function public.notification_finish_action(uuid, text, uuid, boolean, text) from public, anon;
revoke all on function public.notification_snooze(uuid, text) from public, anon;
revoke all on function public.notification_wake_due() from public, anon;
grant execute on function public.notification_begin_action(uuid, text) to authenticated;
grant execute on function public.notification_finish_action(uuid, text, uuid, boolean, text) to authenticated;
grant execute on function public.notification_snooze(uuid, text) to authenticated;
grant execute on function public.notification_wake_due() to authenticated;
