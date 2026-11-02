-- Ntinginya V6 / Slice 1b: Community (feed, posts, comments, reactions, groups, reports, blocks, moderation).
-- Additive only. Run once in Supabase SQL Editor after 006.
-- Administrators/moderators are identified ONLY by Auth app_metadata.role in ('admin','owner') (never user_metadata), same as Safe Mode.
-- NOTE: this file has been statically checked by the project tests but NOT executed against a live Postgres in the build environment.

create or replace function public.community_is_admin()
returns boolean language sql stable security invoker as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('admin', 'owner');
$$;

-- ============ profiles (public face of a member) ============
create table if not exists public.community_profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 40),
  bio text check (bio is null or char_length(bio) <= 300),
  avatar_path text check (avatar_path is null or (char_length(avatar_path) <= 300 and split_part(avatar_path, '/', 1) = user_id::text)),
  show_bio boolean not null default true,
  status text not null default 'active' check (status in ('active','suspended')),
  suspended_reason text check (suspended_reason is null or char_length(suspended_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  blocked_name text check (blocked_name is null or char_length(blocked_name) <= 40), -- remembered so the blocker can still recognise who they blocked
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, blocked_user_id),
  check (user_id <> blocked_user_id)
);

create table if not exists public.community_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 3 and 60),
  description text check (description is null or char_length(description) <= 500),
  privacy text not null default 'public' check (privacy in ('public','private')),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists community_groups_name_uniq on public.community_groups (lower(btrim(name)));

create table if not exists public.community_group_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  group_id uuid not null references public.community_groups(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','moderator','member')),
  status text not null default 'active' check (status in ('active','pending','banned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, user_id)
);
create index if not exists community_group_members_user_idx on public.community_group_members (user_id, status);

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  group_id uuid references public.community_groups(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 2000),
  media_kind text check (media_kind is null or media_kind in ('image','video')),
  media_path text check (media_path is null or (char_length(media_path) <= 300 and split_part(media_path, '/', 1) = user_id::text)),
  media_mime text,
  allow_comments boolean not null default true,
  status text not null default 'visible' check (status in ('visible','hidden','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(body)) > 0 or media_path is not null),
  check ((media_kind is null) = (media_path is null))
);
create index if not exists community_posts_feed_idx on public.community_posts (created_at desc, id desc) where status = 'visible';
create index if not exists community_posts_group_idx on public.community_posts (group_id, created_at desc);
create index if not exists community_posts_user_idx on public.community_posts (user_id, created_at desc);

create table if not exists public.community_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  post_id uuid not null references public.community_posts(id) on delete cascade,
  parent_id uuid,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  status text not null default 'visible' check (status in ('visible','hidden','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, post_id),
  foreign key (parent_id, post_id) references public.community_comments (id, post_id) on delete cascade
);
create index if not exists community_comments_post_idx on public.community_comments (post_id, created_at);

create table if not exists public.community_reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  post_id uuid references public.community_posts(id) on delete cascade,
  comment_id uuid references public.community_comments(id) on delete cascade,
  kind text not null default 'like' check (kind in ('like','love','support','celebrate')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((post_id is null) <> (comment_id is null))
);
create unique index if not exists community_reactions_post_uniq on public.community_reactions (user_id, post_id) where post_id is not null;
create unique index if not exists community_reactions_comment_uniq on public.community_reactions (user_id, comment_id) where comment_id is not null;
create index if not exists community_reactions_post_idx on public.community_reactions (post_id);

create table if not exists public.community_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  post_id uuid references public.community_posts(id) on delete cascade,
  comment_id uuid references public.community_comments(id) on delete cascade,
  reported_user_id uuid references auth.users(id) on delete cascade,
  reason text not null check (reason in ('spam','abuse','harassment','hate','violence','sexual','self_harm','misinformation','other')),
  details text check (details is null or char_length(details) <= 500),
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((post_id is not null)::int + (comment_id is not null)::int + (reported_user_id is not null)::int = 1)
);
create unique index if not exists community_reports_once_post on public.community_reports (user_id, post_id) where post_id is not null;
create unique index if not exists community_reports_once_comment on public.community_reports (user_id, comment_id) where comment_id is not null;
create unique index if not exists community_reports_once_user on public.community_reports (user_id, reported_user_id) where reported_user_id is not null;
create index if not exists community_reports_status_idx on public.community_reports (status, created_at desc);

create table if not exists public.community_moderation_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action text not null check (action in ('hide_post','restore_post','remove_post','hide_comment','restore_comment','remove_comment','suspend_user','restore_user','suspend_group','restore_group','resolve_report','dismiss_report')),
  target_type text not null check (target_type in ('post','comment','user','group','report')),
  target_id uuid not null,
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists community_moderation_log_idx on public.community_moderation_log (created_at desc);

-- ============ helper functions (SECURITY DEFINER only where RLS would otherwise hide the rows being checked) ============
-- Each one only answers a yes/no question about the CALLER (auth.uid()), reveals nothing else, and pins search_path.
create or replace function public.community_blocked(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.community_blocks b
    where (b.user_id = auth.uid() and b.blocked_user_id = other) or (b.user_id = other and b.blocked_user_id = auth.uid())
  );
$$;

create or replace function public.community_is_group_member(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.community_group_members m where m.group_id = gid and m.user_id = auth.uid() and m.status = 'active');
$$;

create or replace function public.community_is_group_mod(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.community_group_members m where m.group_id = gid and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner','moderator'));
$$;

create or replace function public.community_can_post()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.community_profiles p where p.user_id = auth.uid() and p.status = 'active');
$$;

revoke all on function public.community_blocked(uuid) from public, anon;
revoke all on function public.community_is_group_member(uuid) from public, anon;
revoke all on function public.community_is_group_mod(uuid) from public, anon;
revoke all on function public.community_can_post() from public, anon;
grant execute on function public.community_blocked(uuid) to authenticated;
grant execute on function public.community_is_group_member(uuid) to authenticated;
grant execute on function public.community_is_group_mod(uuid) to authenticated;
grant execute on function public.community_can_post() to authenticated;

-- ============ guards (SECURITY INVOKER triggers) ============
-- Only administrators may change moderation fields; ordinary users editing their own rows cannot touch them.
create or replace function public.community_guard_status()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.status is distinct from old.status and not public.community_is_admin() then
    raise exception 'moderation_only';
  end if;
  if tg_table_name = 'community_profiles' and new.suspended_reason is distinct from old.suspended_reason and not public.community_is_admin() then
    raise exception 'moderation_only';
  end if;
  if tg_table_name = 'community_reports' and (new.resolved_by is distinct from old.resolved_by or new.resolution_note is distinct from old.resolution_note) and not public.community_is_admin() then
    raise exception 'moderation_only';
  end if;
  return new;
end $$;

-- Spam limits per user (own rows only, so RLS lets the count run): posts 20/hour, comments 60/hour, reactions 300/hour, reports 20/day.
create or replace function public.community_rate_limit()
returns trigger language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  if tg_table_name = 'community_posts' then
    select count(*) into n from public.community_posts where user_id = new.user_id and created_at > now() - interval '1 hour';
    if n >= 20 then raise exception 'rate_limited'; end if;
  elsif tg_table_name = 'community_comments' then
    select count(*) into n from public.community_comments where user_id = new.user_id and created_at > now() - interval '1 hour';
    if n >= 60 then raise exception 'rate_limited'; end if;
  elsif tg_table_name = 'community_reactions' then
    select count(*) into n from public.community_reactions where user_id = new.user_id and created_at > now() - interval '1 hour';
    if n >= 300 then raise exception 'rate_limited'; end if;
  elsif tg_table_name = 'community_reports' then
    select count(*) into n from public.community_reports where user_id = new.user_id and created_at > now() - interval '1 day';
    if n >= 20 then raise exception 'rate_limited'; end if;
  end if;
  return new;
end $$;

-- A comment's target post must accept comments.
create or replace function public.community_guard_comment()
returns trigger language plpgsql security invoker set search_path = public as $$
declare ok boolean;
begin
  select allow_comments and status = 'visible' into ok from public.community_posts where id = new.post_id;
  if ok is distinct from true then raise exception 'comments_closed'; end if;
  return new;
end $$;

-- Tells a post's owner when someone comments or reacts. SECURITY DEFINER because it writes ANOTHER user's notification row;
-- it takes only ids from the new row, never free text from the caller, and skips self-actions and blocked pairs.
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
    'community:' || case when tg_table_name = 'community_comments' then 'comment:' else 'react:' end || new.id::text,
    'open', jsonb_build_object('post', post)
  ) on conflict (user_id, dedupe_key) do nothing;
  return new;
end $$;

drop trigger if exists community_profiles_guard on public.community_profiles;
create trigger community_profiles_guard before update on public.community_profiles for each row execute function public.community_guard_status();
drop trigger if exists community_posts_guard on public.community_posts;
create trigger community_posts_guard before update on public.community_posts for each row execute function public.community_guard_status();
drop trigger if exists community_comments_guard on public.community_comments;
create trigger community_comments_guard before update on public.community_comments for each row execute function public.community_guard_status();
drop trigger if exists community_groups_guard on public.community_groups;
create trigger community_groups_guard before update on public.community_groups for each row execute function public.community_guard_status();
drop trigger if exists community_reports_guard on public.community_reports;
create trigger community_reports_guard before update on public.community_reports for each row execute function public.community_guard_status();
drop trigger if exists community_posts_rate on public.community_posts;
create trigger community_posts_rate before insert on public.community_posts for each row execute function public.community_rate_limit();
drop trigger if exists community_comments_rate on public.community_comments;
create trigger community_comments_rate before insert on public.community_comments for each row execute function public.community_rate_limit();
drop trigger if exists community_reactions_rate on public.community_reactions;
create trigger community_reactions_rate before insert on public.community_reactions for each row execute function public.community_rate_limit();
drop trigger if exists community_reports_rate on public.community_reports;
create trigger community_reports_rate before insert on public.community_reports for each row execute function public.community_rate_limit();
drop trigger if exists community_comments_open on public.community_comments;
create trigger community_comments_open before insert on public.community_comments for each row execute function public.community_guard_comment();
drop trigger if exists community_comments_notify on public.community_comments;
create trigger community_comments_notify after insert on public.community_comments for each row execute function public.community_notify();
drop trigger if exists community_reactions_notify on public.community_reactions;
create trigger community_reactions_notify after insert on public.community_reactions for each row execute function public.community_notify();

do $$
declare t text;
begin
  foreach t in array array['community_profiles','community_blocks','community_groups','community_group_members','community_posts','community_comments','community_reactions','community_reports','community_moderation_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end
$$;

-- ============ RLS policies ============
-- profiles: any signed-in member can read (except across a block); you create/edit only your own; admins can suspend.
drop policy if exists community_profiles_select on public.community_profiles;
create policy community_profiles_select on public.community_profiles for select to authenticated
  using (user_id = (select auth.uid()) or public.community_is_admin() or not public.community_blocked(user_id));
drop policy if exists community_profiles_insert on public.community_profiles;
create policy community_profiles_insert on public.community_profiles for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'active');
drop policy if exists community_profiles_update on public.community_profiles;
create policy community_profiles_update on public.community_profiles for update to authenticated
  using (user_id = (select auth.uid()) or public.community_is_admin())
  with check (user_id = (select auth.uid()) or public.community_is_admin());
drop policy if exists community_profiles_delete on public.community_profiles;
create policy community_profiles_delete on public.community_profiles for delete to authenticated
  using (user_id = (select auth.uid()) or public.community_is_admin());

-- blocks: private to the blocker.
drop policy if exists community_blocks_all on public.community_blocks;
drop policy if exists community_blocks_select on public.community_blocks;
create policy community_blocks_select on public.community_blocks for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists community_blocks_insert on public.community_blocks;
create policy community_blocks_insert on public.community_blocks for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists community_blocks_delete on public.community_blocks;
create policy community_blocks_delete on public.community_blocks for delete to authenticated using (user_id = (select auth.uid()));

-- groups: names are visible to every member (so people can find and ask to join); content of private groups is not.
drop policy if exists community_groups_select on public.community_groups;
create policy community_groups_select on public.community_groups for select to authenticated using (status = 'active' or user_id = (select auth.uid()) or public.community_is_admin());
drop policy if exists community_groups_insert on public.community_groups;
create policy community_groups_insert on public.community_groups for insert to authenticated with check (user_id = (select auth.uid()) and status = 'active' and public.community_can_post());
drop policy if exists community_groups_update on public.community_groups;
create policy community_groups_update on public.community_groups for update to authenticated
  using (user_id = (select auth.uid()) or public.community_is_admin()) with check (user_id = (select auth.uid()) or public.community_is_admin());
drop policy if exists community_groups_delete on public.community_groups;
create policy community_groups_delete on public.community_groups for delete to authenticated using (user_id = (select auth.uid()) or public.community_is_admin());

-- memberships: public groups join instantly; private groups create a 'pending' request an owner/moderator must accept.
drop policy if exists community_group_members_select on public.community_group_members;
create policy community_group_members_select on public.community_group_members for select to authenticated
  using (user_id = (select auth.uid()) or public.community_is_group_member(group_id) or public.community_is_admin());
drop policy if exists community_group_members_insert on public.community_group_members;
create policy community_group_members_insert on public.community_group_members for insert to authenticated
  with check (
    user_id = (select auth.uid()) and public.community_can_post() and (
      (role = 'owner' and status = 'active' and exists (select 1 from public.community_groups g where g.id = group_id and g.user_id = (select auth.uid())))
      or (role = 'member' and status = 'active' and exists (select 1 from public.community_groups g where g.id = group_id and g.privacy = 'public' and g.status = 'active'))
      or (role = 'member' and status = 'pending' and exists (select 1 from public.community_groups g where g.id = group_id and g.privacy = 'private' and g.status = 'active'))
    )
  );
drop policy if exists community_group_members_update on public.community_group_members;
create policy community_group_members_update on public.community_group_members for update to authenticated
  using (public.community_is_group_mod(group_id) or public.community_is_admin())
  with check (public.community_is_group_mod(group_id) or public.community_is_admin());
drop policy if exists community_group_members_delete on public.community_group_members;
create policy community_group_members_delete on public.community_group_members for delete to authenticated
  using (user_id = (select auth.uid()) or public.community_is_group_mod(group_id) or public.community_is_admin());

-- posts
drop policy if exists community_posts_select on public.community_posts;
create policy community_posts_select on public.community_posts for select to authenticated
  using (
    user_id = (select auth.uid()) or public.community_is_admin()
    or (
      status = 'visible' and not public.community_blocked(user_id)
      and (group_id is null
           or public.community_is_group_member(group_id)
           or exists (select 1 from public.community_groups g where g.id = group_id and g.privacy = 'public' and g.status = 'active'))
    )
  );
drop policy if exists community_posts_insert on public.community_posts;
create policy community_posts_insert on public.community_posts for insert to authenticated
  with check (
    user_id = (select auth.uid()) and status = 'visible' and public.community_can_post()
    and (group_id is null or public.community_is_group_member(group_id))
  );
drop policy if exists community_posts_update on public.community_posts;
create policy community_posts_update on public.community_posts for update to authenticated
  using (user_id = (select auth.uid()) or public.community_is_admin())
  with check (user_id = (select auth.uid()) or public.community_is_admin());
drop policy if exists community_posts_delete on public.community_posts;
create policy community_posts_delete on public.community_posts for delete to authenticated
  using (user_id = (select auth.uid()) or public.community_is_admin());

-- comments (readable whenever the post is readable: the sub-select runs under the post policy above)
drop policy if exists community_comments_select on public.community_comments;
create policy community_comments_select on public.community_comments for select to authenticated
  using (
    user_id = (select auth.uid()) or public.community_is_admin()
    or (status = 'visible' and not public.community_blocked(user_id) and exists (select 1 from public.community_posts p where p.id = post_id))
  );
drop policy if exists community_comments_insert on public.community_comments;
create policy community_comments_insert on public.community_comments for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'visible' and public.community_can_post()
              and exists (select 1 from public.community_posts p where p.id = post_id));
drop policy if exists community_comments_update on public.community_comments;
create policy community_comments_update on public.community_comments for update to authenticated
  using (user_id = (select auth.uid()) or public.community_is_admin()) with check (user_id = (select auth.uid()) or public.community_is_admin());
drop policy if exists community_comments_delete on public.community_comments;
create policy community_comments_delete on public.community_comments for delete to authenticated using (user_id = (select auth.uid()) or public.community_is_admin());

-- reactions
drop policy if exists community_reactions_select on public.community_reactions;
create policy community_reactions_select on public.community_reactions for select to authenticated
  using (user_id = (select auth.uid()) or public.community_is_admin()
         or (post_id is not null and exists (select 1 from public.community_posts p where p.id = post_id))
         or (comment_id is not null and exists (select 1 from public.community_comments c where c.id = comment_id)));
drop policy if exists community_reactions_insert on public.community_reactions;
create policy community_reactions_insert on public.community_reactions for insert to authenticated
  with check (user_id = (select auth.uid()) and public.community_can_post()
              and ((post_id is not null and exists (select 1 from public.community_posts p where p.id = post_id))
                   or (comment_id is not null and exists (select 1 from public.community_comments c where c.id = comment_id))));
drop policy if exists community_reactions_update on public.community_reactions;
create policy community_reactions_update on public.community_reactions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists community_reactions_delete on public.community_reactions;
create policy community_reactions_delete on public.community_reactions for delete to authenticated using (user_id = (select auth.uid()));

-- reports: the reporter files and sees their own; only administrators see all and resolve.
drop policy if exists community_reports_select on public.community_reports;
create policy community_reports_select on public.community_reports for select to authenticated using (user_id = (select auth.uid()) or public.community_is_admin());
drop policy if exists community_reports_insert on public.community_reports;
create policy community_reports_insert on public.community_reports for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'open' and resolved_by is null and (reported_user_id is null or reported_user_id <> (select auth.uid())));
drop policy if exists community_reports_update on public.community_reports;
create policy community_reports_update on public.community_reports for update to authenticated using (public.community_is_admin()) with check (public.community_is_admin());

-- moderation log: administrators only; every entry is attributed to the acting administrator.
drop policy if exists community_moderation_log_select on public.community_moderation_log;
create policy community_moderation_log_select on public.community_moderation_log for select to authenticated using (public.community_is_admin());
drop policy if exists community_moderation_log_insert on public.community_moderation_log;
create policy community_moderation_log_insert on public.community_moderation_log for insert to authenticated with check (public.community_is_admin() and user_id = (select auth.uid()));

revoke all on public.community_profiles, public.community_blocks, public.community_groups, public.community_group_members, public.community_posts,
  public.community_comments, public.community_reactions, public.community_reports, public.community_moderation_log from anon;
grant select, insert, update, delete on public.community_profiles, public.community_blocks, public.community_groups, public.community_group_members, public.community_posts,
  public.community_comments, public.community_reactions, public.community_reports to authenticated;
grant select, insert on public.community_moderation_log to authenticated;

-- ============ read views (security_invoker: the caller's RLS applies to every underlying table) ============
create or replace view public.community_feed with (security_invoker = true) as
select
  p.id, p.user_id, p.group_id, p.body, p.media_kind, p.media_path, p.media_mime, p.allow_comments, p.status, p.created_at,
  cp.display_name as author_name,
  cp.avatar_path as author_avatar,
  g.name as group_name,
  (select count(*) from public.community_reactions r where r.post_id = p.id) as reaction_count,
  (select count(*) from public.community_comments c where c.post_id = p.id and c.status = 'visible') as comment_count,
  (select r.kind from public.community_reactions r where r.post_id = p.id and r.user_id = auth.uid()) as my_reaction,
  ((select count(*) from public.community_reactions r where r.post_id = p.id and r.created_at > now() - interval '7 days')
   + 2 * (select count(*) from public.community_comments c where c.post_id = p.id and c.status = 'visible' and c.created_at > now() - interval '7 days')) as trend_score
from public.community_posts p
left join public.community_profiles cp on cp.user_id = p.user_id
left join public.community_groups g on g.id = p.group_id;

create or replace view public.community_groups_view with (security_invoker = true) as
select g.id, g.user_id, g.name, g.description, g.privacy, g.status, g.created_at,
  (select count(*) from public.community_group_members m where m.group_id = g.id and m.status = 'active') as member_count,
  (select m.status from public.community_group_members m where m.group_id = g.id and m.user_id = auth.uid()) as my_status,
  (select m.role from public.community_group_members m where m.group_id = g.id and m.user_id = auth.uid()) as my_role
from public.community_groups g;

grant select on public.community_feed, public.community_groups_view to authenticated;
revoke all on public.community_feed, public.community_groups_view from anon;

-- ============ media bucket (private; read through short-lived signed URLs) ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-media', 'community-media', false, 52428800,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public = false, file_size_limit = 52428800, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists community_media_select on storage.objects;
create policy community_media_select on storage.objects for select to authenticated using (bucket_id = 'community-media');
drop policy if exists community_media_insert on storage.objects;
create policy community_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'community-media' and (storage.foldername(name))[1] = (select auth.uid())::text and public.community_can_post());
drop policy if exists community_media_update on storage.objects;
create policy community_media_update on storage.objects for update to authenticated
  using (bucket_id = 'community-media' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'community-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists community_media_delete on storage.objects;
create policy community_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'community-media' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.community_is_admin()));
