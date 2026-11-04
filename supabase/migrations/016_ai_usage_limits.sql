-- Shared, atomic AI request limits for serverless API instances. Each user has one row
-- containing only the timestamps needed for the rolling 24-hour and per-minute limits.
create table if not exists public.ai_usage_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  request_times timestamptz[] not null default '{}'::timestamptz[]
);

alter table public.ai_usage_limits enable row level security;
revoke all on public.ai_usage_limits from public, anon, authenticated;

insert into public.ai_usage_limits (user_id, request_times)
select user_id, array_agg(created_at order by created_at)
from public.ai_messages
where role = 'user' and created_at >= now() - interval '24 hours'
group by user_id
on conflict (user_id) do nothing;

-- Keep implementation in a non-exposed schema. Authenticated users can invoke only
-- the zero-argument public wrapper below, never the implementation itself.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
drop function if exists public.consume_ai_request(integer, integer, boolean);
drop function if exists public.consume_ai_request();
drop function if exists private.consume_ai_request();

create function private.consume_ai_request()
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid := auth.uid();
  recent timestamptz[];
  daily_count integer;
  burst_count integer;
begin
  if caller is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  insert into public.ai_usage_limits (user_id) values (caller)
  on conflict (user_id) do nothing;

  -- Serialize all requests for this user before checking or updating either quota.
  select request_times into recent
  from public.ai_usage_limits
  where user_id = caller
  for update;

  select coalesce(array_agg(requested_at order by requested_at), '{}'::timestamptz[])
    into recent
  from unnest(recent) as requests(requested_at)
  where requested_at >= now() - interval '24 hours';

  daily_count := coalesce(array_length(recent, 1), 0);
  select count(*) into burst_count
  from unnest(recent) as requests(requested_at)
  where requested_at >= now() - interval '1 minute';

  if burst_count >= 8 then
    return query select false, 'burst_limit'::text;
    return;
  end if;
  if daily_count >= 100 then
    return query select false, 'daily_limit'::text;
    return;
  end if;

  update public.ai_usage_limits
  set request_times = recent || now()
  where user_id = caller;
  return query select true, null::text;
end
$$;

-- Do not expose the implementation through PostgREST or direct SQL grants.
revoke all on function private.consume_ai_request() from public, anon, authenticated;

create function public.consume_ai_request()
returns table (allowed boolean, reason text)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select * from private.consume_ai_request();
$$;

revoke all on function public.consume_ai_request() from public, anon;
revoke all on function public.consume_ai_request() from authenticated;
grant execute on function public.consume_ai_request() to authenticated;
