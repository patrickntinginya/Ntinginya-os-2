-- Ntinginya V6 / Slice 1c: security hardening for Community (found by reviewing 007). Additive; run once after 007.
-- NOTE: statically checked by tests/slice1-hardening.test.js but NOT executed against a live Postgres in the build environment.
-- Verify with supabase/tests/slice1_rls.sql in the Supabase SQL editor before going live.

-- 1. A suspended member could delete their own profile and re-create it as 'active', escaping the suspension.
--    Now only an ACTIVE member may delete their own profile (a suspended one needs an administrator).
drop policy if exists community_profiles_delete on public.community_profiles;
create policy community_profiles_delete on public.community_profiles for delete to authenticated
  using ((user_id = (select auth.uid()) and status = 'active') or public.community_is_admin());

-- 2. A banned group member could delete their own membership row and re-join a public group.
--    Now a banned member cannot remove their own row; moderators and administrators still can.
drop policy if exists community_group_members_delete on public.community_group_members;
create policy community_group_members_delete on public.community_group_members for delete to authenticated
  using ((user_id = (select auth.uid()) and status <> 'banned') or public.community_is_group_mod(group_id) or public.community_is_admin());

-- 3. Editing a post could move it into a group the author is not a member of (INSERT checked membership, UPDATE did not).
drop policy if exists community_posts_update on public.community_posts;
create policy community_posts_update on public.community_posts for update to authenticated
  using (user_id = (select auth.uid()) or public.community_is_admin())
  with check (
    public.community_is_admin()
    or (user_id = (select auth.uid()) and (group_id is null or public.community_is_group_member(group_id)))
  );

-- 4. Membership rows: only the group OWNER (or an administrator) may change a role; nobody may re-point a row to another user or group.
create or replace function public.community_is_group_owner(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.community_group_members m where m.group_id = gid and m.user_id = auth.uid() and m.status = 'active' and m.role = 'owner');
$$;
revoke all on function public.community_is_group_owner(uuid) from public, anon;
grant execute on function public.community_is_group_owner(uuid) to authenticated;

create or replace function public.community_guard_member()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.user_id is distinct from old.user_id or new.group_id is distinct from old.group_id then
    raise exception 'membership_immutable';
  end if;
  if new.role is distinct from old.role and not (public.community_is_admin() or public.community_is_group_owner(new.group_id)) then
    raise exception 'owner_only';
  end if;
  return new;
end $$;
drop trigger if exists community_group_members_guard on public.community_group_members;
create trigger community_group_members_guard before update on public.community_group_members for each row execute function public.community_guard_member();

-- 5. Reaction notifications were keyed per reaction row, so toggling a reaction on/off repeatedly flooded the post owner.
--    The key is now (post, actor): at most ONE reaction notification per person per post. Comments keep one per comment.
create or replace function public.community_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner_id uuid; actor_name text; post uuid;
begin
  post := new.post_id;
  if post is null then return new; end if; -- a reaction on a comment: no notification in this version
  select user_id into owner_id from public.community_posts where id = post;
  if owner_id is null or owner_id = new.user_id then return new; end if;
  if exists (select 1 from public.community_blocks b where (b.user_id = owner_id and b.blocked_user_id = new.user_id) or (b.user_id = new.user_id and b.blocked_user_id = owner_id)) then
    return new;
  end if;
  select display_name into actor_name from public.community_profiles where user_id = new.user_id;
  insert into public.notifications (user_id, type, title, body, link, dedupe_key, action_kind, action_ref)
  values (
    owner_id, 'community',
    case when tg_table_name = 'community_comments' then 'New comment on your post' else 'Someone reacted to your post' end,
    coalesce(actor_name, 'A member'),
    '/community?post=' || post::text,
    case when tg_table_name = 'community_comments' then 'community:comment:' || new.id::text
         else 'community:react:' || post::text || ':' || new.user_id::text end,
    'open', jsonb_build_object('post', post)
  ) on conflict (user_id, dedupe_key) do nothing;
  return new;
end $$;
