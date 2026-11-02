-- RLS isolation test. Run in the Supabase SQL editor AFTER both migrations. It changes nothing permanently:
-- everything happens inside a transaction that ends with ROLLBACK.
-- Expected result: every notice says PASS. Any FAIL notice (or an error) means data is not isolated - do not go live.
begin;

do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a';
  b uuid := '00000000-0000-0000-0000-00000000000b';
  tbl text;
  n integer;
  failures integer := 0;
  -- Every user-owned table that has a user_id column.
  tables text[] := array['profiles','tasks','schedule_events','goals','ideas','learning_items','income','expenses','reminders',
    'projects','milestones','study_sessions','notes','finance_categories','budgets','financial_goals',
    'recurring_transactions','notifications','ai_conversations','ai_messages','ai_action_requests','habits','habit_entries'];
  goal_b uuid;
  conv_b uuid;
begin
  -- Two throwaway users (rolled back at the end).
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-a@example.test', '{}', now(), now()),
         (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-b@example.test', '{}', now(), now());

  -- User B creates data.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.tasks (title) values ('B secret task');
  insert into public.goals (name) values ('B secret goal') returning id into goal_b;
  insert into public.notes (title, content) values ('B note', 'private');
  insert into public.expenses (amount, category) values (1000, 'Food');
  insert into public.income (amount) values (5000);
  insert into public.budgets (category, month, amount) values ('Food', date_trunc('month', now())::date, 100000);
  insert into public.ai_conversations (title) values ('B chat') returning id into conv_b;
  insert into public.habits (name) values ('B habit');

  -- User A must see nothing of B's.
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  foreach tbl in array tables loop
    execute format('select count(*) from public.%I where user_id = %L', tbl, b) into n;
    if n > 0 then failures := failures + 1; raise notice 'FAIL: A can read % rows of B in %', n, tbl;
    else raise notice 'PASS: A cannot read B rows in %', tbl; end if;
  end loop;

  -- A must not be able to write as B.
  begin
    insert into public.tasks (user_id, title) values (b, 'A pretending to be B');
    failures := failures + 1; raise notice 'FAIL: A inserted a task owned by B';
  exception when others then raise notice 'PASS: A cannot insert a task owned by B'; end;

  -- A must not be able to link its own record to B's goal.
  begin
    insert into public.tasks (title, goal_id) values ('A task', goal_b);
    failures := failures + 1; raise notice 'FAIL: A linked a task to B''s goal';
  exception when others then raise notice 'PASS: A cannot link a task to B''s goal'; end;

  begin
    insert into public.ai_messages (conversation_id, role, content) values (conv_b, 'user', 'hi');
    failures := failures + 1; raise notice 'FAIL: A wrote into B''s AI conversation';
  exception when others then raise notice 'PASS: A cannot write into B''s AI conversation'; end;

  -- A must not be able to update or delete B's rows (0 rows affected).
  update public.tasks set title = 'hacked' where user_id = b;
  get diagnostics n = row_count;
  if n > 0 then failures := failures + 1; raise notice 'FAIL: A updated B''s tasks'; else raise notice 'PASS: A cannot update B''s tasks'; end if;
  delete from public.goals where user_id = b;
  get diagnostics n = row_count;
  if n > 0 then failures := failures + 1; raise notice 'FAIL: A deleted B''s goals'; else raise notice 'PASS: A cannot delete B''s goals'; end if;

  -- Finance functions must only total the caller's own money.
  select total_income into n from public.finance_totals();
  if n <> 0 then failures := failures + 1; raise notice 'FAIL: finance_totals leaked B''s income'; else raise notice 'PASS: finance_totals only counts A'; end if;

  -- Logged-out (anon) must not read anything.
  reset role;
  set local role anon;
  begin
    execute 'select count(*) from public.tasks' into n;
    failures := failures + 1; raise notice 'FAIL: anon can query tasks';
  exception when others then raise notice 'PASS: anon cannot query tasks'; end;

  reset role;
  if failures = 0 then raise notice 'ALL CHECKS PASSED'; else raise notice '% CHECK(S) FAILED', failures; end if;
end
$$;

rollback;
