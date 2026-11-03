-- Shared AI rate-limit regression tests. Run only on a disposable local database.
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
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
    (user_a, inst, 'authenticated', 'authenticated', 'ai-limit-a@example.test', '{}', now(), now()),
    (user_b, inst, 'authenticated', 'authenticated', 'ai-limit-b@example.test', '{}', now(), now());

  perform set_config('request.jwt.claims', claims_a, true);
  set local role authenticated;
  select * into decision from public.consume_ai_request(2, 8, true);
  if decision.allowed then raise notice 'PASS: request accepted below rolling daily limit';
  else failures := failures + 1; raise notice 'FAIL: request unexpectedly blocked below daily limit'; end if;

  select * into decision from public.consume_ai_request(2, 8, true);
  if decision.allowed then raise notice 'PASS: second request accepted at daily limit';
  else failures := failures + 1; raise notice 'FAIL: second request unexpectedly blocked'; end if;

  select * into decision from public.consume_ai_request(2, 8, true);
  if not decision.allowed and decision.reason = 'daily_limit' then raise notice 'PASS: request refused at daily quota';
  else failures := failures + 1; raise notice 'FAIL: daily quota was not enforced'; end if;

  perform set_config('request.jwt.claims', claims_b, true);
  select * into decision from public.consume_ai_request(100, 2, false);
  if decision.allowed then raise notice 'PASS: burst window is independent per user';
  else failures := failures + 1; raise notice 'FAIL: other user inherited the first user limit'; end if;

  select * into decision from public.consume_ai_request(100, 2, false);
  if decision.allowed then raise notice 'PASS: burst limit allows requests below configured threshold';
  else failures := failures + 1; raise notice 'FAIL: burst request unexpectedly blocked'; end if;

  select * into decision from public.consume_ai_request(100, 2, false);
  if not decision.allowed and decision.reason = 'burst_limit' then raise notice 'PASS: per-minute burst limit enforced in database';
  else failures := failures + 1; raise notice 'FAIL: burst limit was not enforced'; end if;

  reset role;
  set local role anon;
  begin
    perform public.consume_ai_request(100, 8, true);
    failures := failures + 1; raise notice 'FAIL: anonymous database role called AI usage limiter';
  exception when insufficient_privilege then raise notice 'PASS: anonymous role cannot call AI usage limiter'; end;
  reset role;

  if failures > 0 then raise exception 'ai_usage_limits had % failure(s)', failures; end if;
  raise notice 'ai_usage_limits: 0 failures';
end $$;
rollback;
