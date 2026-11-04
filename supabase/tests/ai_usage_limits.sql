-- AI usage quota regression tests. Run only on a disposable local Supabase database
-- after applying the repository migrations. Everything, including fixture users and
-- quota rows, is rolled back at the end.
begin;

do $$
declare
  user_a uuid := '00000000-0000-0000-0000-0000000000e1';
  user_b uuid := '00000000-0000-0000-0000-0000000000e2';
  inst uuid := '00000000-0000-0000-0000-000000000000';
  claims_a text := json_build_object('sub', user_a, 'role', 'authenticated')::text;
  claims_b text := json_build_object('sub', user_b, 'role', 'authenticated')::text;
  decision record;
  failures integer := 0;
  i integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
    (user_a, inst, 'authenticated', 'authenticated', 'ai-limit-a@example.test', '{}', now(), now()),
    (user_b, inst, 'authenticated', 'authenticated', 'ai-limit-b@example.test', '{}', now(), now());

  -- Assert the public interface has exactly the no-argument signature and that
  -- ordinary roles cannot access the storage or the private implementation.
  if to_regprocedure('public.consume_ai_request()') is null then
    raise exception 'missing public.consume_ai_request()';
  end if;
  if to_regprocedure('public.consume_ai_request(integer,integer,boolean)') is not null then
    raise exception 'legacy user-controlled quota signature still exists';
  end if;
  if has_table_privilege('authenticated', 'public.ai_usage_limits', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'authenticated role can access ai_usage_limits directly';
  end if;
  if has_schema_privilege('authenticated', 'private', 'USAGE')
     or has_function_privilege('authenticated', 'private.consume_ai_request()', 'EXECUTE') then
    raise exception 'authenticated role can access the private implementation';
  end if;
  -- PUBLIC is a pseudo-role, not a valid role argument to has_function_privilege.
  -- Checking anon is sufficient: it inherits any EXECUTE grant made to PUBLIC.
  if has_function_privilege('anon', 'public.consume_ai_request()', 'EXECUTE') then
    raise exception 'anonymous role can execute the public RPC (directly or via PUBLIC)';
  end if;

  -- Chat and ping use the same zero-argument quota RPC. These first two calls
  -- model one chat plus one connection ping; together with six requests they
  -- consume all eight burst slots in the same user quota.
  perform set_config('request.jwt.claims', claims_a, true);
  set local role authenticated;

  select * into decision from public.consume_ai_request(); -- chat
  if decision.allowed then raise notice 'PASS: chat request accepted';
  else failures := failures + 1; raise notice 'FAIL: chat request unexpectedly blocked'; end if;

  select * into decision from public.consume_ai_request(); -- ping
  if decision.allowed then raise notice 'PASS: ping shares the chat quota';
  else failures := failures + 1; raise notice 'FAIL: ping request unexpectedly blocked'; end if;

  for i in 1..6 loop
    select * into decision from public.consume_ai_request();
    if not decision.allowed then
      failures := failures + 1;
      raise notice 'FAIL: request % of 8 unexpectedly blocked', i + 2;
    end if;
  end loop;

  select * into decision from public.consume_ai_request();
  if not decision.allowed and decision.reason = 'burst_limit' then
    raise notice 'PASS: ninth request within a minute is rejected';
  else
    failures := failures + 1;
    raise notice 'FAIL: eight-per-minute burst limit was not enforced';
  end if;

  -- An authenticated caller cannot pass quota settings, nor call the internal function.
  begin
    execute 'select * from public.consume_ai_request(1, 1, false)';
    failures := failures + 1;
    raise notice 'FAIL: authenticated caller passed custom quota parameters';
  exception when undefined_function then
    raise notice 'PASS: parameterized quota RPC does not exist';
  end;
  begin
    execute 'select * from private.consume_ai_request()';
    failures := failures + 1;
    raise notice 'FAIL: authenticated caller invoked internal implementation';
  exception when insufficient_privilege then
    raise notice 'PASS: authenticated caller cannot invoke internal implementation';
  end;

  -- User B has an independent quota despite user A having exhausted burst slots.
  perform set_config('request.jwt.claims', claims_b, true);
  select * into decision from public.consume_ai_request();
  if decision.allowed then raise notice 'PASS: each user has an independent quota';
  else failures := failures + 1; raise notice 'FAIL: user B inherited user A quota'; end if;
  reset role;

  -- Seed 99 timestamps within the rolling 24-hour window but outside the last
  -- minute. Exactly one more request is allowed; the following request is denied.
  update public.ai_usage_limits
  set request_times = (
    select array_agg(now() - interval '2 minutes' - make_interval(secs => n) order by n)
    from generate_series(1, 99) as series(n)
  )
  where user_id = user_a;

  perform set_config('request.jwt.claims', claims_a, true);
  set local role authenticated;
  select * into decision from public.consume_ai_request();
  if decision.allowed then raise notice 'PASS: request 100 accepted inside rolling 24 hours';
  else failures := failures + 1; raise notice 'FAIL: request 100 unexpectedly blocked'; end if;

  select * into decision from public.consume_ai_request();
  if not decision.allowed and decision.reason = 'daily_limit' then
    raise notice 'PASS: request 101 inside rolling 24 hours is rejected';
  else
    failures := failures + 1;
    raise notice 'FAIL: 100-per-rolling-24-hour limit was not enforced';
  end if;
  reset role;

  -- Timestamps older than 24 hours must age out of the rolling daily count.
  update public.ai_usage_limits
  set request_times = (
    select array_agg(now() - interval '24 hours 1 second' - make_interval(secs => n) order by n)
    from generate_series(1, 100) as series(n)
  )
  where user_id = user_a;
  perform set_config('request.jwt.claims', claims_a, true);
  set local role authenticated;
  select * into decision from public.consume_ai_request();
  if decision.allowed then raise notice 'PASS: requests older than 24 hours no longer count';
  else failures := failures + 1; raise notice 'FAIL: expired requests still count toward daily quota'; end if;
  reset role;

  -- Anonymous callers have no execute grant on the public RPC.
  set local role anon;
  begin
    execute 'select * from public.consume_ai_request()';
    failures := failures + 1;
    raise notice 'FAIL: anonymous role called AI usage limiter';
  exception when insufficient_privilege then
    raise notice 'PASS: anonymous role cannot call AI usage RPC';
  end;
  reset role;

  if failures > 0 then raise exception 'ai_usage_limits had % failure(s)', failures; end if;
  raise notice 'ai_usage_limits: 0 failures';
end $$;

rollback;
