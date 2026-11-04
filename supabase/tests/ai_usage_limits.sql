-- AI usage quota regression assertions. Run only on a disposable local Supabase
-- database after applying the repository migrations. All fixture data is rolled back.
begin;

create function pg_temp.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_condition is distinct from true then
    raise exception 'AI usage quota assertion failed: %', p_message;
  end if;
end
$$;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ai-limit-a@example.test', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ai-limit-b@example.test', '{}', now(), now());

select pg_temp.assert_true(to_regprocedure('public.consume_ai_request()') is not null,
  'public quota RPC has the no-argument signature');
select pg_temp.assert_true(to_regprocedure('public.consume_ai_request(integer,integer,boolean)') is null,
  'caller-controlled quota parameters are not exposed');
select pg_temp.assert_true(not has_table_privilege('authenticated', 'public.ai_usage_limits', 'SELECT,INSERT,UPDATE,DELETE'),
  'authenticated cannot access quota storage directly');
select pg_temp.assert_true(not has_schema_privilege('authenticated', 'private', 'USAGE'),
  'authenticated cannot access the private schema');
select pg_temp.assert_true(not has_function_privilege('authenticated', 'private.consume_ai_request(boolean,integer)', 'EXECUTE'),
  'authenticated cannot execute the private quota implementation');
select pg_temp.assert_true(has_function_privilege('authenticated', 'public.consume_ai_request()', 'EXECUTE'),
  'authenticated can execute the public quota RPC');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.consume_ai_request()', 'EXECUTE'),
  'anon and inherited PUBLIC grants cannot execute the public quota RPC');
select pg_temp.assert_true(has_function_privilege('authenticated', 'public.consume_ai_safe_mode_support()', 'EXECUTE'),
  'authenticated can execute the fixed Safe Mode quota RPC');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.consume_ai_safe_mode_support()', 'EXECUTE'),
  'anon and inherited PUBLIC grants cannot execute the Safe Mode quota RPC');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}',
  true
);
set local role authenticated;
select pg_temp.assert_true((select allowed from public.consume_ai_request()),
  'chat request is accepted below its quotas');
reset role;
create temporary table expected_daily_times as
select request_times
from public.ai_usage_limits
where user_id = '00000000-0000-0000-0000-0000000000e1';
set local role authenticated;
select pg_temp.assert_true((select allowed from public.consume_ai_ping()),
  'connection ping is accepted under the burst quota');
reset role;
select pg_temp.assert_true(
  (select request_times from public.ai_usage_limits where user_id = '00000000-0000-0000-0000-0000000000e1')
    is not distinct from
  (select request_times from expected_daily_times),
  'connection ping preserves daily quota timestamps'
);
select pg_temp.assert_true((
  select count(*) = 1
  from public.ai_usage_limits
  where user_id = '00000000-0000-0000-0000-0000000000e1'
), 'connection ping preserves the existing user quota row');

update public.ai_usage_limits
set request_times = (
  select array_agg(now() - interval '2 minutes' - make_interval(secs => n) order by n)
  from generate_series(1, 99) as series(n)
),
burst_request_times = '{}'::timestamptz[]
where user_id = '00000000-0000-0000-0000-0000000000e1';

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}',
  true
);
set local role authenticated;
select pg_temp.assert_true((select allowed from public.consume_ai_request()),
  'request 100 is accepted within the rolling 24-hour quota');
select pg_temp.assert_true((select reason from public.consume_ai_request()) = 'daily_limit',
  'request 101 is rejected within the rolling 24-hour quota');
reset role;

create temporary table expected_at_daily_limit as
select request_times
from public.ai_usage_limits
where user_id = '00000000-0000-0000-0000-0000000000e1';
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}',
  true
);
set local role authenticated;
select pg_temp.assert_true((select allowed from public.consume_ai_ping()),
  'connection ping remains available after the daily chat quota is reached');
reset role;
select pg_temp.assert_true(
  (select request_times from public.ai_usage_limits where user_id = '00000000-0000-0000-0000-0000000000e1')
    is not distinct from
  (select request_times from expected_at_daily_limit),
  'ping at the daily limit does not modify daily quota timestamps'
);

update public.ai_usage_limits
set request_times = (
  select array_agg(now() - interval '24 hours 1 second' - make_interval(secs => n) order by n)
  from generate_series(1, 100) as series(n)
),
burst_request_times = '{}'::timestamptz[]
where user_id = '00000000-0000-0000-0000-0000000000e1';
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}',
  true
);
set local role authenticated;
select pg_temp.assert_true((select allowed from public.consume_ai_request()),
  'timestamps older than 24 hours no longer count toward the daily quota');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}',
  true
);
select pg_temp.assert_true((select allowed from public.consume_ai_request()),
  'quota is independent per user');
select pg_temp.assert_true((select allowed from public.consume_ai_request()),
  'burst quota accepts request 2 for the independent user');
select pg_temp.assert_true((select allowed from public.consume_ai_request()),
  'burst quota accepts request 3 for the independent user');
select pg_temp.assert_true((select allowed from public.consume_ai_request()),
  'burst quota accepts request 4 for the independent user');
select pg_temp.assert_true((select allowed from public.consume_ai_request()),
  'burst quota accepts request 5 for the independent user');
select pg_temp.assert_true((select allowed from public.consume_ai_request()),
  'burst quota accepts request 6 for the independent user');
select pg_temp.assert_true((select allowed from public.consume_ai_request()),
  'burst quota accepts request 7 for the independent user');
select pg_temp.assert_true((select allowed from public.consume_ai_request()),
  'burst quota accepts request 8 for the independent user');
select pg_temp.assert_true((select reason from public.consume_ai_request()) = 'burst_limit',
  'ninth request within a minute is rejected');
reset role;

do $$
begin
  raise notice 'AI_USAGE_LIMITS: PASS (27 assertions)';
end
$$;
rollback;
