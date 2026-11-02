-- Ntinginya V6 / Slice 1a: Smart Action Center.
-- Additive only. Extends the existing public.notifications table (no data is dropped or rewritten except a safe backfill of NEW columns).
-- Run once in Supabase SQL Editor after migrations 001-005.

-- ============ notifications: action + scheduling columns ============
alter table public.notifications add column if not exists action_kind text;
alter table public.notifications add column if not exists action_ref jsonb not null default '{}'::jsonb;
alter table public.notifications add column if not exists due_at timestamptz;
alter table public.notifications add column if not exists status text not null default 'open';
alter table public.notifications add column if not exists snoozed_until timestamptz;
alter table public.notifications add column if not exists snooze_count integer not null default 0;
alter table public.notifications add column if not exists action_started_at timestamptz;
alter table public.notifications add column if not exists executed_at timestamptz;
alter table public.notifications add column if not exists action_result text;

alter table public.notifications drop constraint if exists notifications_status_check;
alter table public.notifications add constraint notifications_status_check check (status in ('open','running','done','dismissed'));
alter table public.notifications drop constraint if exists notifications_action_kind_check;
alter table public.notifications add constraint notifications_action_kind_check
  check (action_kind is null or action_kind in ('open','complete_reminder','complete_task','log_habit'));

-- More notification types (the earlier list is kept in full).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('reminder','overdue_task','budget','goal_deadline','learning','ai','habit','project','briefing','weekly_review',
                  'community','appointment','payment','subscription','security'));

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc, id desc);
create index if not exists notifications_user_due_idx on public.notifications (user_id, status, due_at);
create index if not exists notifications_user_snooze_idx on public.notifications (user_id, snoozed_until) where snoozed_until is not null;

-- Backfill ONLY the new columns of existing rows, from their dedupe_key (reminder:<uuid>:date, overdue:<uuid>:date, habit:<uuid>:date).
update public.notifications set action_kind = 'complete_reminder', action_ref = jsonb_build_object('id', split_part(dedupe_key, ':', 2))
  where action_kind is null and dedupe_key like 'reminder:%' and split_part(dedupe_key, ':', 2) ~ '^[0-9a-f-]{36}$';
update public.notifications set action_kind = 'complete_task', action_ref = jsonb_build_object('id', split_part(dedupe_key, ':', 2))
  where action_kind is null and dedupe_key like 'overdue:%' and split_part(dedupe_key, ':', 2) ~ '^[0-9a-f-]{36}$';
update public.notifications set action_kind = 'log_habit', action_ref = jsonb_build_object('id', split_part(dedupe_key, ':', 2), 'date', split_part(dedupe_key, ':', 3))
  where action_kind is null and dedupe_key like 'habit:%' and split_part(dedupe_key, ':', 2) ~ '^[0-9a-f-]{36}$';
update public.notifications set action_kind = 'open' where action_kind is null and link is not null;

-- ============ notification_actions: audit + idempotency of DO IT / snooze ============
create table if not exists public.notification_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  action text not null check (action in ('do_it','snooze','wake')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  outcome text not null default 'started' check (outcome in ('started','succeeded','failed','duplicate')),
  detail text check (detail is null or char_length(detail) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index if not exists notification_actions_notification_idx on public.notification_actions (notification_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['notification_actions']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_select_own" on public.%I', t, t);
    execute format('drop policy if exists "%s_insert_own" on public.%I', t, t);
    execute format('drop policy if exists "%s_update_own" on public.%I', t, t);
    execute format('drop policy if exists "%s_delete_own" on public.%I', t, t);
    execute format('create policy "%s_select_own" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t, t);
    execute format('create policy "%s_insert_own" on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t, t);
    execute format('create policy "%s_update_own" on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t, t);
    execute format('create policy "%s_delete_own" on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t, t);
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end
$$;

-- ============ functions (SECURITY INVOKER: they run with the caller's rights, so RLS still applies) ============

-- Claims a notification for execution. Exactly one caller can claim it; a repeated call with the same key, or a second
-- device, gets claimed=false and nothing runs twice. A claim stuck in 'running' for over 2 minutes (app killed mid-action) may be re-claimed.
create or replace function public.notification_begin_action(p_notification uuid, p_key text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare n public.notifications; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into n from public.notifications where id = p_notification and user_id = uid for update;
  if not found then raise exception 'not_found'; end if;
  if n.status = 'done' then
    return jsonb_build_object('claimed', false, 'status', 'done', 'result', n.action_result);
  end if;
  if n.status = 'dismissed' then
    return jsonb_build_object('claimed', false, 'status', 'dismissed');
  end if;
  if n.status = 'running' and n.action_started_at > now() - interval '2 minutes' then
    return jsonb_build_object('claimed', false, 'status', 'running');
  end if;
  insert into public.notification_actions (notification_id, action, idempotency_key, outcome)
    values (n.id, 'do_it', left(p_key, 100), 'started')
    on conflict (user_id, idempotency_key) do nothing;
  update public.notifications set status = 'running', action_started_at = now(), is_read = true where id = n.id;
  return jsonb_build_object('claimed', true, 'status', 'running', 'action_kind', n.action_kind, 'action_ref', n.action_ref, 'link', n.link);
end $$;

-- Records the outcome of a claimed action. Success -> done (final). Failure -> back to open so the user can retry.
create or replace function public.notification_finish_action(p_notification uuid, p_key text, p_ok boolean, p_result text default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare uid uuid := auth.uid(); n public.notifications;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into n from public.notifications where id = p_notification and user_id = uid for update;
  if not found then raise exception 'not_found'; end if;
  if n.status <> 'running' then
    return jsonb_build_object('status', n.status);
  end if;
  if p_ok then
    update public.notifications set status = 'done', executed_at = now(), action_result = left(coalesce(p_result, 'done'), 500),
      snoozed_until = null, is_read = true where id = n.id;
  else
    update public.notifications set status = 'open', action_started_at = null, action_result = left(coalesce(p_result, 'failed'), 500) where id = n.id;
  end if;
  update public.notification_actions set outcome = case when p_ok then 'succeeded' else 'failed' end, detail = left(p_result, 500)
    where user_id = uid and idempotency_key = left(p_key, 100);
  return jsonb_build_object('status', case when p_ok then 'done' else 'open' end);
end $$;

-- REMIND ME AFTER 5M. The server clock decides the time (never the phone's), and the delay is fixed at five minutes.
-- Pressing it again while a snooze is already pending returns the same time instead of creating or extending a reminder.
create or replace function public.notification_snooze(p_notification uuid, p_key text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare uid uuid := auth.uid(); n public.notifications; until_ts timestamptz;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into n from public.notifications where id = p_notification and user_id = uid for update;
  if not found then raise exception 'not_found'; end if;
  if n.status in ('done','dismissed') then
    return jsonb_build_object('snoozed', false, 'status', n.status);
  end if;
  if n.snoozed_until is not null and n.snoozed_until > now() then
    return jsonb_build_object('snoozed', true, 'duplicate', true, 'snoozed_until', n.snoozed_until);
  end if;
  until_ts := now() + interval '5 minutes';
  update public.notifications set snoozed_until = until_ts, snooze_count = snooze_count + 1, is_read = true where id = n.id;
  insert into public.notification_actions (notification_id, action, idempotency_key, outcome, detail)
    values (n.id, 'snooze', left(p_key, 100), 'succeeded', until_ts::text)
    on conflict (user_id, idempotency_key) do nothing;
  return jsonb_build_object('snoozed', true, 'duplicate', false, 'snoozed_until', until_ts);
end $$;

-- Brings back every snoozed notification whose five minutes are over: unread again, snooze cleared. Returns them so the app can
-- show a device notification. A second call returns nothing (the update already cleared snoozed_until), so it never fires twice.
create or replace function public.notification_wake_due()
returns setof public.notifications language sql security invoker set search_path = public as $$
  update public.notifications set snoozed_until = null, is_read = false, due_at = coalesce(due_at, now())
  where user_id = auth.uid() and status = 'open' and snoozed_until is not null and snoozed_until <= now()
  returning *;
$$;

revoke all on function public.notification_begin_action(uuid, text) from public, anon;
revoke all on function public.notification_finish_action(uuid, text, boolean, text) from public, anon;
revoke all on function public.notification_snooze(uuid, text) from public, anon;
revoke all on function public.notification_wake_due() from public, anon;
grant execute on function public.notification_begin_action(uuid, text) to authenticated;
grant execute on function public.notification_finish_action(uuid, text, boolean, text) to authenticated;
grant execute on function public.notification_snooze(uuid, text) to authenticated;
grant execute on function public.notification_wake_due() to authenticated;
