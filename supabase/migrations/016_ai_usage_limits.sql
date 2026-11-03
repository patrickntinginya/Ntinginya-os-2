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

create or replace function public.consume_ai_request(
  p_daily_limit integer,
  p_burst_limit integer,
  p_enforce_daily boolean
)
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  recent timestamptz[];
  daily_count integer;
  burst_count integer;
begin
  if caller is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_daily_limit not between 1 and 1000 or p_burst_limit not between 1 and 30 or p_enforce_daily is null then
    raise exception 'invalid_ai_limit' using errcode = '22023';
  end if;

  insert into public.ai_usage_limits (user_id) values (caller)
  on conflict (user_id) do nothing;

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

  if burst_count >= p_burst_limit then
    return query select false, 'burst_limit'::text;
    return;
  end if;
  if p_enforce_daily and daily_count >= p_daily_limit then
    return query select false, 'daily_limit'::text;
    return;
  end if;

  update public.ai_usage_limits
  set request_times = recent || now()
  where user_id = caller;
  return query select true, null::text;
end
$$;

revoke all on function public.consume_ai_request(integer, integer, boolean) from public, anon;
grant execute on function public.consume_ai_request(integer, integer, boolean) to authenticated;
