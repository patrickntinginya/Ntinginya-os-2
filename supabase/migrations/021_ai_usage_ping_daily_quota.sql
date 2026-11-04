-- Connection tests keep the per-minute burst guard but do not count against daily AI usage.
alter table public.ai_usage_limits
  add column if not exists burst_request_times timestamptz[] not null default '{}'::timestamptz[];

-- Preserve the existing rate-limit window when upgrading from migration 016.
update public.ai_usage_limits
set burst_request_times = request_times
where cardinality(burst_request_times) = 0 and cardinality(request_times) > 0;

-- The private quota parameters are never caller-controlled: public wrappers select
-- fixed modes while the implementation owns both quota limits.
create or replace function private.consume_ai_request(
  p_enforce_daily boolean,
  p_burst_limit integer
)
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid := auth.uid();
  recent_daily timestamptz[];
  recent_burst timestamptz[];
  daily_count integer;
  burst_count integer;
begin
  if caller is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_enforce_daily is null or p_burst_limit not between 1 and 8 then
    raise exception 'invalid_ai_quota_mode' using errcode = '22023';
  end if;

  insert into public.ai_usage_limits (user_id) values (caller)
  on conflict (user_id) do nothing;

  select request_times, burst_request_times into recent_daily, recent_burst
  from public.ai_usage_limits
  where user_id = caller
  for update;

  select coalesce(array_agg(requested_at order by requested_at), '{}'::timestamptz[])
    into recent_daily
  from unnest(recent_daily) as requests(requested_at)
  where requested_at >= now() - interval '24 hours';

  select coalesce(array_agg(requested_at order by requested_at), '{}'::timestamptz[])
    into recent_burst
  from unnest(recent_burst) as requests(requested_at)
  where requested_at >= now() - interval '1 minute';

  daily_count := coalesce(array_length(recent_daily, 1), 0);
  burst_count := coalesce(array_length(recent_burst, 1), 0);

  if burst_count >= p_burst_limit then
    return query select false, 'burst_limit'::text;
    return;
  end if;
  if p_enforce_daily and daily_count >= 100 then
    return query select false, 'daily_limit'::text;
    return;
  end if;

  update public.ai_usage_limits
  set request_times = case when p_enforce_daily then recent_daily || now() else recent_daily end,
      burst_request_times = recent_burst || now()
  where user_id = caller;
  return query select true, null::text;
end
$$;

revoke all on function private.consume_ai_request(boolean, integer) from public, anon, authenticated;

create or replace function private.consume_ai_request()
returns table (allowed boolean, reason text)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select * from private.consume_ai_request(true, 8);
$$;

revoke all on function private.consume_ai_request() from public, anon, authenticated;

create or replace function public.consume_ai_request()
returns table (allowed boolean, reason text)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select * from private.consume_ai_request();
$$;

revoke all on function public.consume_ai_request() from public, anon, authenticated;
grant execute on function public.consume_ai_request() to authenticated;

create or replace function public.consume_ai_ping()
returns table (allowed boolean, reason text)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select * from private.consume_ai_request(false, 8);
$$;

revoke all on function public.consume_ai_ping() from public, anon, authenticated;
grant execute on function public.consume_ai_ping() to authenticated;

create or replace function public.consume_ai_safe_mode_support()
returns table (allowed boolean, reason text)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select * from private.consume_ai_request(true, 5);
$$;

revoke all on function public.consume_ai_safe_mode_support() from public, anon, authenticated;
grant execute on function public.consume_ai_safe_mode_support() to authenticated;
