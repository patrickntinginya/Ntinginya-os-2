-- V6 Community live chat: one-to-one and group conversations, delivery/read marks, reports, blocking, private media, Realtime authorization.
-- Run after 001-009. Additive only. Administrators come ONLY from Auth app_metadata.role (public.community_is_admin()), never user_metadata.
--
-- Privacy model (decisions, see docs/CHAT.md):
--  * Conversations, members and messages are readable ONLY by active members. Administrators can NOT read private chats; they only see what a
--    member REPORTED (a snapshot stored at report time), so moderators never get a general window into private messages.
--  * A person added to a group later sees messages only from the moment they joined (history_from). Leaving a group removes access.
--  * Messages from someone you blocked are hidden from you; nobody can start or continue a direct chat across a block (either direction).
--  * Messages cannot be edited in place by clients: edits, deletes, reads and membership changes go through functions that check the caller.

-- ---------------------------------------------------------------- tables
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct','group')),
  title text check (title is null or char_length(btrim(title)) between 1 and 60),
  direct_key text unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','locked')),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'direct' and direct_key is not null and title is null) or (kind = 'group' and direct_key is null and title is not null))
);

create table if not exists public.chat_members (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('member','admin')),
  joined_at timestamptz not null default now(),
  history_from timestamptz not null default now(),
  left_at timestamptz,
  last_delivered_at timestamptz,
  last_read_at timestamptz,
  muted boolean not null default false,
  primary key (conversation_id, user_id)
);
create index if not exists chat_members_user_idx on public.chat_members (user_id) where left_at is null;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid not null default gen_random_uuid(),
  kind text not null default 'text' check (kind in ('text','image','video','file','voice')),
  body text check (body is null or char_length(body) <= 4000),
  media_path text check (media_path is null or char_length(media_path) <= 300),
  media_name text check (media_name is null or char_length(media_name) <= 120),
  media_mime text check (media_mime is null or char_length(media_mime) <= 100),
  media_size bigint check (media_size is null or (media_size > 0 and media_size <= 52428800)),
  duration_ms integer check (duration_ms is null or (duration_ms >= 0 and duration_ms <= 600000)),
  reply_to uuid references public.chat_messages(id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (conversation_id, sender_id, client_id),
  check (deleted_at is not null
         or (kind = 'text' and body is not null and char_length(btrim(body)) > 0 and media_path is null)
         or (kind <> 'text' and media_path is not null))
);
create index if not exists chat_messages_conv_created_idx on public.chat_messages (conversation_id, created_at desc, id desc);
create index if not exists chat_messages_media_idx on public.chat_messages (media_path) where media_path is not null;

create table if not exists public.chat_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  message_id uuid references public.chat_messages(id) on delete set null,
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  reported_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('spam','abuse','harassment','inappropriate','other')),
  details text check (details is null or char_length(details) <= 500),
  snapshot_kind text not null,
  snapshot_body text check (snapshot_body is null or char_length(snapshot_body) <= 4000),
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (reporter_id, message_id)
);
create index if not exists chat_reports_status_idx on public.chat_reports (status, created_at desc);

create table if not exists public.chat_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  show_last_seen boolean not null default true,
  allow_new_chats boolean not null default true, -- false: nobody can start a direct chat with me or add me to a group
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_last_seen (
  user_id uuid primary key references auth.users(id) on delete cascade,
  seen_at timestamptz not null default now()
);

alter table public.chat_conversations enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reports enable row level security;
alter table public.chat_settings enable row level security;
alter table public.chat_last_seen enable row level security;

-- ---------------------------------------------------------------- helper functions (all run with the CALLER'S auth.uid())
create or replace function public.chat_is_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_members m where m.conversation_id = cid and m.user_id = (select auth.uid()) and m.left_at is null)
$$;
create or replace function public.chat_is_group_admin(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_members m join public.chat_conversations c on c.id = m.conversation_id
                 where m.conversation_id = cid and m.user_id = (select auth.uid()) and m.left_at is null and m.role = 'admin' and c.kind = 'group')
$$;
create or replace function public.chat_blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.community_blocks k where (k.user_id = a and k.blocked_user_id = b) or (k.user_id = b and k.blocked_user_id = a))
$$;
-- May the caller send into this conversation right now? Active member, conversation not locked, caller not suspended, no block in a direct chat.
create or replace function public.chat_can_send(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_conversations c
    join public.chat_members m on m.conversation_id = c.id and m.user_id = (select auth.uid()) and m.left_at is null
    where c.id = cid and c.status = 'active'
      and not exists (select 1 from public.community_profiles p where p.user_id = (select auth.uid()) and p.status = 'suspended')
      and (c.kind = 'group' or not exists (
            select 1 from public.chat_members o
            where o.conversation_id = c.id and o.user_id <> (select auth.uid()) and public.chat_blocked_between((select auth.uid()), o.user_id)))
  )
$$;
-- Storage helpers: names look like <sender uuid>/<conversation uuid>/<file>. CASE keeps the uuid casts from running on malformed names.
create or replace function public.chat_storage_can_write(object_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
    then split_part(object_name, '/', 1) = (select auth.uid())::text and public.chat_can_send(split_part(object_name, '/', 2)::uuid)
    else false end
$$;
create or replace function public.chat_storage_can_read(object_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
    then (split_part(object_name, '/', 1) = (select auth.uid())::text)
      or exists (
        select 1 from public.chat_messages m
        join public.chat_members mem on mem.conversation_id = m.conversation_id and mem.user_id = (select auth.uid()) and mem.left_at is null
        where m.media_path = object_name and m.deleted_at is null and m.created_at >= mem.history_from
          and not exists (select 1 from public.community_blocks b where b.user_id = (select auth.uid()) and b.blocked_user_id = m.sender_id))
    else false end
$$;
create or replace function public.chat_topic_member(topic text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when topic ~ '^chat:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then public.chat_is_member(substr(topic, 6)::uuid) else false end
$$;

-- ---------------------------------------------------------------- policies (read access only; every change goes through a function)
drop policy if exists chat_conversations_select on public.chat_conversations;
create policy chat_conversations_select on public.chat_conversations for select to authenticated using (public.chat_is_member(id));
drop policy if exists chat_members_select on public.chat_members;
create policy chat_members_select on public.chat_members for select to authenticated using (public.chat_is_member(conversation_id));

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages for select to authenticated using (
  exists (select 1 from public.chat_members mem where mem.conversation_id = chat_messages.conversation_id and mem.user_id = (select auth.uid())
          and mem.left_at is null and chat_messages.created_at >= mem.history_from)
  and not exists (select 1 from public.community_blocks b where b.user_id = (select auth.uid()) and b.blocked_user_id = chat_messages.sender_id)
);
drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and public.chat_can_send(conversation_id));

drop policy if exists chat_reports_select on public.chat_reports;
create policy chat_reports_select on public.chat_reports for select to authenticated using (reporter_id = (select auth.uid()) or public.community_is_admin());
drop policy if exists chat_reports_update on public.chat_reports;
create policy chat_reports_update on public.chat_reports for update to authenticated using (public.community_is_admin()) with check (public.community_is_admin());

drop policy if exists chat_settings_select on public.chat_settings;
create policy chat_settings_select on public.chat_settings for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists chat_settings_insert on public.chat_settings;
create policy chat_settings_insert on public.chat_settings for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists chat_settings_update on public.chat_settings;
create policy chat_settings_update on public.chat_settings for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- chat_last_seen: no policy = no direct access (read through chat_last_seen_of(), written by chat_touch()).

revoke all on public.chat_conversations, public.chat_members, public.chat_messages, public.chat_reports, public.chat_settings, public.chat_last_seen from anon, authenticated;
grant select on public.chat_conversations, public.chat_members to authenticated;
grant select, insert on public.chat_messages to authenticated;
grant select, update on public.chat_reports to authenticated;
grant select, insert, update on public.chat_settings to authenticated;

-- ---------------------------------------------------------------- triggers
create or replace function public.chat_messages_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare recent integer;
begin
  new.created_at := now();      -- the server decides the time
  new.edited_at := null; new.deleted_at := null;
  if new.media_path is not null and new.media_path not like new.sender_id::text || '/' || new.conversation_id::text || '/%' then
    raise exception 'bad_media_path' using errcode = '42501';
  end if;
  if new.reply_to is not null and not exists (select 1 from public.chat_messages r where r.id = new.reply_to and r.conversation_id = new.conversation_id) then
    raise exception 'bad_reply' using errcode = '22023';
  end if;
  select count(*) into recent from public.chat_messages m where m.sender_id = new.sender_id and m.created_at > now() - interval '10 seconds';
  if recent >= 20 then raise exception 'rate_limited' using errcode = '54000'; end if;
  return new;
end $$;
drop trigger if exists chat_messages_before_insert on public.chat_messages;
create trigger chat_messages_before_insert before insert on public.chat_messages for each row execute function public.chat_messages_before_insert();

-- After a message: bump the conversation, and keep ONE unread "new messages" notification per conversation for every other, un-muted, un-blocked member.
create or replace function public.chat_messages_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; preview text; mem record;
begin
  update public.chat_conversations set last_message_at = new.created_at where id = new.conversation_id;
  select display_name into who from public.community_profiles where user_id = new.sender_id;
  preview := case new.kind when 'text' then left(new.body, 80) when 'image' then 'Photo' when 'video' then 'Video' when 'voice' then 'Voice message' else coalesce(left(new.media_name, 80), 'File') end;
  for mem in
    select m.user_id from public.chat_members m
    where m.conversation_id = new.conversation_id and m.user_id <> new.sender_id and m.left_at is null and not m.muted
      and not public.chat_blocked_between(new.sender_id, m.user_id)
  loop
    insert into public.notifications (user_id, type, title, body, link, dedupe_key, action_kind, action_ref)
    values (mem.user_id, 'community', 'New message', coalesce(who, 'A member') || ': ' || preview, '/community?chat=' || new.conversation_id::text,
            'chat:' || new.conversation_id::text, 'open', jsonb_build_object('chat', new.conversation_id))
    on conflict (user_id, dedupe_key) do update set body = excluded.body, is_read = false, status = 'open', snoozed_until = null; -- a new message always resurfaces the alert
  end loop;
  return new;
end $$;
drop trigger if exists chat_messages_after_insert on public.chat_messages;
create trigger chat_messages_after_insert after insert on public.chat_messages for each row execute function public.chat_messages_after_insert();

-- ---------------------------------------------------------------- conversation functions
create or replace function public.chat_profile_ok(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.community_profiles p where p.user_id = uid and p.status = 'active')
$$;
create or replace function public.chat_accepts_new_chats(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.allow_new_chats from public.chat_settings s where s.user_id = uid), true)
$$;

create or replace function public.chat_start_direct(p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := (select auth.uid()); k text; cid uuid;
begin
  if me is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_other is null or p_other = me then raise exception 'invalid_user' using errcode = '22023'; end if;
  if not public.chat_profile_ok(me) then raise exception 'profile_required' using errcode = '42501'; end if;
  if not public.chat_profile_ok(p_other) then raise exception 'user_unavailable' using errcode = '42501'; end if;
  if public.chat_blocked_between(me, p_other) then raise exception 'blocked' using errcode = '42501'; end if;
  k := least(me::text, p_other::text) || ':' || greatest(me::text, p_other::text);
  select id into cid from public.chat_conversations where direct_key = k;
  if cid is null then
    if not public.chat_accepts_new_chats(p_other) then raise exception 'dm_disabled' using errcode = '42501'; end if;
    insert into public.chat_conversations (kind, direct_key, created_by) values ('direct', k, me) on conflict (direct_key) do nothing returning id into cid;
    if cid is null then select id into cid from public.chat_conversations where direct_key = k; end if;
    insert into public.chat_members (conversation_id, user_id, role) values (cid, me, 'member'), (cid, p_other, 'member') on conflict do nothing;
  end if;
  return cid;
end $$;

create or replace function public.chat_create_group(p_title text, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := (select auth.uid()); cid uuid; u uuid; ids uuid[]; t text := btrim(coalesce(p_title, ''));
begin
  if me is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if char_length(t) < 1 or char_length(t) > 60 then raise exception 'bad_title' using errcode = '22023'; end if;
  if not public.chat_profile_ok(me) then raise exception 'profile_required' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct x), '{}') into ids from unnest(coalesce(p_members, '{}')) x where x is not null and x <> me;
  if coalesce(array_length(ids, 1), 0) < 1 or array_length(ids, 1) > 49 then raise exception 'bad_member_count' using errcode = '22023'; end if;
  if (select count(*) from public.chat_conversations c where c.created_by = me and c.kind = 'group' and c.created_at > now() - interval '1 hour') >= 10 then raise exception 'rate_limited' using errcode = '54000'; end if;
  foreach u in array ids loop
    if not public.chat_profile_ok(u) then raise exception 'user_unavailable' using errcode = '42501'; end if;
    if public.chat_blocked_between(me, u) then raise exception 'blocked' using errcode = '42501'; end if;
    if not public.chat_accepts_new_chats(u) then raise exception 'dm_disabled' using errcode = '42501'; end if;
  end loop;
  insert into public.chat_conversations (kind, title, created_by) values ('group', t, me) returning id into cid;
  insert into public.chat_members (conversation_id, user_id, role) values (cid, me, 'admin');
  insert into public.chat_members (conversation_id, user_id, role) select cid, x, 'member' from unnest(ids) x;
  return cid;
end $$;

create or replace function public.chat_add_members(p_conv uuid, p_members uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := (select auth.uid()); u uuid; active integer;
begin
  if not public.chat_is_group_admin(p_conv) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.chat_conversations c where c.id = p_conv and c.status = 'active') then raise exception 'locked' using errcode = '42501'; end if;
  select count(*) into active from public.chat_members where conversation_id = p_conv and left_at is null;
  if active + coalesce(array_length(p_members, 1), 0) > 50 then raise exception 'group_full' using errcode = '54000'; end if;
  foreach u in array coalesce(p_members, '{}') loop
    if u is null or u = me then continue; end if;
    if not public.chat_profile_ok(u) then raise exception 'user_unavailable' using errcode = '42501'; end if;
    if public.chat_blocked_between(me, u) then raise exception 'blocked' using errcode = '42501'; end if;
    if not public.chat_accepts_new_chats(u) then raise exception 'dm_disabled' using errcode = '42501'; end if;
    insert into public.chat_members (conversation_id, user_id, role) values (p_conv, u, 'member')
    on conflict (conversation_id, user_id) do update set left_at = null, role = 'member', joined_at = now(), history_from = now(), last_read_at = null, last_delivered_at = null
      where public.chat_members.left_at is not null; -- already an active member: nothing changes
  end loop;
end $$;

create or replace function public.chat_remove_member(p_conv uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.chat_is_group_admin(p_conv) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_user = (select auth.uid()) then raise exception 'use_leave' using errcode = '22023'; end if;
  update public.chat_members set left_at = now() where conversation_id = p_conv and user_id = p_user and left_at is null;
end $$;

create or replace function public.chat_leave(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := (select auth.uid());
begin
  if not exists (select 1 from public.chat_conversations c where c.id = p_conv and c.kind = 'group') then raise exception 'not_a_group' using errcode = '22023'; end if;
  update public.chat_members set left_at = now() where conversation_id = p_conv and user_id = me and left_at is null;
  -- a group must keep an administrator: promote the longest-standing member if the last admin left
  if not exists (select 1 from public.chat_members where conversation_id = p_conv and left_at is null and role = 'admin') then
    update public.chat_members set role = 'admin'
    where (conversation_id, user_id) = (select conversation_id, user_id from public.chat_members where conversation_id = p_conv and left_at is null order by joined_at limit 1);
  end if;
end $$;

create or replace function public.chat_rename(p_conv uuid, p_title text) returns void
language plpgsql security definer set search_path = public as $$
declare t text := btrim(coalesce(p_title, ''));
begin
  if not public.chat_is_group_admin(p_conv) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if char_length(t) < 1 or char_length(t) > 60 then raise exception 'bad_title' using errcode = '22023'; end if;
  update public.chat_conversations set title = t where id = p_conv and kind = 'group';
end $$;

create or replace function public.chat_set_muted(p_conv uuid, p_muted boolean) returns void
language sql security definer set search_path = public as $$
  update public.chat_members set muted = coalesce(p_muted, false) where conversation_id = p_conv and user_id = (select auth.uid()) and left_at is null
$$;

-- Delivery and read marks use the SERVER clock and only ever move forward.
create or replace function public.chat_mark(p_conv uuid, p_read boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := (select auth.uid());
begin
  update public.chat_members set
    last_delivered_at = greatest(coalesce(last_delivered_at, 'epoch'::timestamptz), now()),
    last_read_at = case when p_read then greatest(coalesce(last_read_at, 'epoch'::timestamptz), now()) else last_read_at end
  where conversation_id = p_conv and user_id = me and left_at is null;
  if p_read then update public.notifications set is_read = true where user_id = me and dedupe_key = 'chat:' || p_conv::text and not is_read; end if;
end $$;
create or replace function public.chat_mark_all_delivered() returns void
language sql security definer set search_path = public as $$
  update public.chat_members set last_delivered_at = greatest(coalesce(last_delivered_at, 'epoch'::timestamptz), now()) where user_id = (select auth.uid()) and left_at is null
$$;

-- Edit own text message (within 24 h) / delete own message (returns the media path so the app can remove the file).
create or replace function public.chat_edit(p_message uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare b text := btrim(coalesce(p_body, '')); m public.chat_messages;
begin
  if char_length(b) < 1 or char_length(b) > 4000 then raise exception 'bad_body' using errcode = '22023'; end if;
  select * into m from public.chat_messages where id = p_message for update;
  if not found or m.sender_id <> (select auth.uid()) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if m.kind <> 'text' or m.deleted_at is not null then raise exception 'not_editable' using errcode = '22023'; end if;
  if m.created_at < now() - interval '24 hours' then raise exception 'too_old' using errcode = '22023'; end if;
  if not public.chat_can_send(m.conversation_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.chat_messages set body = b, edited_at = now() where id = p_message;
end $$;

create or replace function public.chat_delete(p_message uuid) returns text
language plpgsql security definer set search_path = public as $$
declare m public.chat_messages; old_path text;
begin
  select * into m from public.chat_messages where id = p_message for update;
  if not found or m.sender_id <> (select auth.uid()) then raise exception 'not_allowed' using errcode = '42501'; end if;
  old_path := m.media_path;
  if m.deleted_at is null then
    update public.chat_messages set deleted_at = now(), body = null, media_path = null, media_name = null, media_mime = null, media_size = null, duration_ms = null where id = p_message;
  end if;
  return old_path;
end $$;

create or replace function public.chat_report(p_message uuid, p_reason text, p_details text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := (select auth.uid()); m public.chat_messages; rid uuid;
begin
  select * into m from public.chat_messages where id = p_message;
  if not found or m.deleted_at is not null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.chat_members x where x.conversation_id = m.conversation_id and x.user_id = me and x.left_at is null and m.created_at >= x.history_from) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if m.sender_id = me then raise exception 'own_message' using errcode = '22023'; end if;
  insert into public.chat_reports (reporter_id, message_id, conversation_id, reported_user_id, reason, details, snapshot_kind, snapshot_body)
  values (me, m.id, m.conversation_id, m.sender_id, p_reason, left(p_details, 500), m.kind, coalesce(m.body, m.media_name))
  on conflict (reporter_id, message_id) do nothing returning id into rid;
  return rid; -- null when this member already reported this message
end $$;

-- Last seen: only for people who share a conversation with me, not across a block, and only if they allow it.
create or replace function public.chat_touch() returns void
language sql security definer set search_path = public as $$
  insert into public.chat_last_seen (user_id, seen_at) values ((select auth.uid()), now()) on conflict (user_id) do update set seen_at = now()
$$;
create or replace function public.chat_last_seen_of(p_user uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select ls.seen_at from public.chat_last_seen ls
  where ls.user_id = p_user
    and coalesce((select s.show_last_seen from public.chat_settings s where s.user_id = p_user), true)
    and not public.chat_blocked_between((select auth.uid()), p_user)
    and exists (select 1 from public.chat_members a join public.chat_members b on b.conversation_id = a.conversation_id
                where a.user_id = (select auth.uid()) and a.left_at is null and b.user_id = p_user and b.left_at is null)
$$;

-- Inbox: SECURITY INVOKER on purpose, so row security (history_from, blocks, membership) applies to every number it returns.
create or replace function public.chat_inbox()
returns table (conversation_id uuid, kind text, title text, status text, last_message_at timestamptz, last_kind text, last_preview text, last_sender uuid,
               unread bigint, member_count bigint, other_user uuid, muted boolean, role text)
language sql stable security invoker set search_path = public as $$
  select c.id, c.kind, c.title, c.status, c.last_message_at, lm.kind, lm.preview, lm.sender_id,
    (select count(*) from public.chat_messages m where m.conversation_id = c.id and m.sender_id <> (select auth.uid()) and m.deleted_at is null
        and m.created_at > coalesce(me.last_read_at, me.joined_at) and m.created_at >= me.history_from),
    (select count(*) from public.chat_members x where x.conversation_id = c.id and x.left_at is null),
    (select x.user_id from public.chat_members x where x.conversation_id = c.id and c.kind = 'direct' and x.user_id <> (select auth.uid()) limit 1),
    me.muted, me.role
  from public.chat_members me
  join public.chat_conversations c on c.id = me.conversation_id
  left join lateral (
    select m.kind, case when m.deleted_at is not null then null else left(coalesce(m.body, m.media_name, ''), 80) end as preview, m.sender_id
    from public.chat_messages m where m.conversation_id = c.id and m.created_at >= me.history_from order by m.created_at desc, m.id desc limit 1) lm on true
  where me.user_id = (select auth.uid()) and me.left_at is null
  order by c.last_message_at desc nulls last, c.created_at desc
  limit 200
$$;

-- ---------------------------------------------------------------- function privileges
do $$
declare f text;
begin
  -- Callable by signed-in members. Each one only ever acts for / reports about the CALLER (auth.uid()).
  foreach f in array array[
    'chat_is_member(uuid)','chat_is_group_admin(uuid)','chat_can_send(uuid)','chat_storage_can_write(text)','chat_storage_can_read(text)','chat_topic_member(text)',
    'chat_start_direct(uuid)','chat_create_group(text,uuid[])','chat_add_members(uuid,uuid[])','chat_remove_member(uuid,uuid)','chat_leave(uuid)','chat_rename(uuid,text)',
    'chat_set_muted(uuid,boolean)','chat_mark(uuid,boolean)','chat_mark_all_delivered()','chat_edit(uuid,text)','chat_delete(uuid)','chat_report(uuid,text,text)',
    'chat_touch()','chat_last_seen_of(uuid)','chat_inbox()']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- Internal helpers: they take ARBITRARY user ids (who blocked whom, who has a profile, who accepts chats), so clients must never call them directly.
  -- The functions above run with the owner's rights and can still use them.
  foreach f in array array['chat_blocked_between(uuid,uuid)','chat_profile_ok(uuid)','chat_accepts_new_chats(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  -- trigger functions are never called directly
  revoke all on function public.chat_messages_before_insert() from public, anon, authenticated;
  revoke all on function public.chat_messages_after_insert() from public, anon, authenticated;
end $$;

-- ---------------------------------------------------------------- private media bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 52428800, array[
  'image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm','video/quicktime',
  'audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/aac','audio/wav','audio/x-m4a',
  'application/pdf','text/plain','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = 52428800, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists chat_media_select on storage.objects;
create policy chat_media_select on storage.objects for select to authenticated using (bucket_id = 'chat-media' and public.chat_storage_can_read(name));
drop policy if exists chat_media_insert on storage.objects;
create policy chat_media_insert on storage.objects for insert to authenticated with check (bucket_id = 'chat-media' and public.chat_storage_can_write(name));
drop policy if exists chat_media_delete on storage.objects;
create policy chat_media_delete on storage.objects for delete to authenticated using (bucket_id = 'chat-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- no update policy: files are immutable once uploaded.

-- ---------------------------------------------------------------- Realtime
-- Row changes (postgres_changes) are filtered by the SELECT policies above. Typing and presence travel on PRIVATE broadcast channels named
-- chat:<conversation uuid>; Realtime Authorization checks membership with chat_topic_member(). Guarded so this file still applies where Realtime is absent.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.chat_messages; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.chat_members; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.chat_conversations; exception when duplicate_object then null; end;
  end if;
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists chat_realtime_read on realtime.messages';
    execute 'create policy chat_realtime_read on realtime.messages for select to authenticated using (public.chat_topic_member(realtime.topic()))';
    execute 'drop policy if exists chat_realtime_write on realtime.messages';
    execute 'create policy chat_realtime_write on realtime.messages for insert to authenticated with check (public.chat_topic_member(realtime.topic()))';
  end if;
end $$;
