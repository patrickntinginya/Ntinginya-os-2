-- Personal Life OS - V2 migration (additive). Run AFTER 001_v1_foundation.sql, once, in the Supabase SQL editor.
-- It never drops a table. It widens a few V1 constraints and maps old values to the new ones (see comments).

-- ============ profiles: TZS is the default currency ============
alter table public.profiles alter column currency set default 'TZS';
-- V1 defaulted every profile to 'USD' without the user choosing it. Move those to TZS.
-- If you deliberately picked USD in V1 Settings, set it again in Settings after running this.
update public.profiles set currency = 'TZS' where currency = 'USD';

-- ============ projects (created first: other tables link to it) ============
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  description text,
  status text not null default 'planning' check (status in ('planning','active','on_hold','completed','archived')),
  deadline date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_user_status_idx on public.projects (user_id, status);

-- ============ goals ============
alter table public.goals add column if not exists priority text not null default 'medium';
alter table public.goals add column if not exists start_date date;
alter table public.goals add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.goals drop constraint if exists goals_priority_check;
alter table public.goals add constraint goals_priority_check check (priority in ('low','medium','high'));
alter table public.goals drop constraint if exists goals_status_check;
-- V1 statuses not_started / in_progress both become 'active'.
update public.goals set status = 'active' where status in ('not_started','in_progress');
alter table public.goals add constraint goals_status_check check (status in ('active','completed','paused','archived'));
alter table public.goals alter column status set default 'active';
create index if not exists goals_project_idx on public.goals (project_id);

-- ============ milestones ============
create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  title text not null check (char_length(btrim(title)) > 0),
  due_date date,
  is_done boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists milestones_goal_idx on public.milestones (user_id, goal_id, position);

-- ============ tasks ============
alter table public.tasks add column if not exists status text;
alter table public.tasks add column if not exists goal_id uuid references public.goals(id) on delete set null;
alter table public.tasks add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.tasks add column if not exists recurrence text not null default 'none';
alter table public.tasks add column if not exists importance smallint not null default 3;
update public.tasks set status = case when completed then 'completed' else 'todo' end where status is null;
alter table public.tasks alter column status set default 'todo';
alter table public.tasks alter column status set not null;
alter table public.tasks drop constraint if exists tasks_priority_check;
alter table public.tasks add constraint tasks_priority_check check (priority in ('low','medium','high','urgent'));
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check check (status in ('todo','in_progress','completed','cancelled'));
alter table public.tasks drop constraint if exists tasks_recurrence_check;
alter table public.tasks add constraint tasks_recurrence_check check (recurrence in ('none','daily','weekly','monthly'));
alter table public.tasks drop constraint if exists tasks_importance_check;
alter table public.tasks add constraint tasks_importance_check check (importance between 1 and 5);
create index if not exists tasks_goal_idx on public.tasks (goal_id);
create index if not exists tasks_project_idx on public.tasks (project_id);

-- Keep the V1 boolean "completed" and the new "status" in step with each other.
create or replace function public.sync_task_completion()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    -- Only the V1 boolean changed: derive status from it. Otherwise status is the source of truth.
    if new.status is not distinct from old.status and new.completed is distinct from old.completed then
      new.status := case when new.completed then 'completed' else 'todo' end;
    else
      new.completed := (new.status = 'completed');
    end if;
    if new.completed then
      if old.completed is not true then new.completed_at := coalesce(new.completed_at, now()); end if;
    else
      new.completed_at := null;
    end if;
  else
    new.completed := (new.status = 'completed');
    if new.completed then new.completed_at := coalesce(new.completed_at, now()); else new.completed_at := null; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists sync_task_completion on public.tasks;
create trigger sync_task_completion before insert or update on public.tasks
  for each row execute function public.sync_task_completion();

-- ============ schedule_events ============
alter table public.schedule_events add column if not exists location text;
alter table public.schedule_events add column if not exists repeat_option text not null default 'none';
alter table public.schedule_events add column if not exists repeat_until date;
alter table public.schedule_events add column if not exists reminder_minutes integer;
alter table public.schedule_events drop constraint if exists schedule_events_repeat_option_check;
alter table public.schedule_events add constraint schedule_events_repeat_option_check check (repeat_option in ('none','daily','weekly','monthly'));
alter table public.schedule_events drop constraint if exists schedule_events_reminder_minutes_check;
alter table public.schedule_events add constraint schedule_events_reminder_minutes_check check (reminder_minutes is null or reminder_minutes between 0 and 10080);

-- ============ reminders ============
alter table public.reminders add column if not exists priority text not null default 'medium';
alter table public.reminders add column if not exists task_id uuid references public.tasks(id) on delete set null;
alter table public.reminders add column if not exists goal_id uuid references public.goals(id) on delete set null;
alter table public.reminders add column if not exists repeat_interval_days integer;
alter table public.reminders drop constraint if exists reminders_priority_check;
alter table public.reminders add constraint reminders_priority_check check (priority in ('low','medium','high'));
alter table public.reminders drop constraint if exists reminders_repeat_option_check;
alter table public.reminders add constraint reminders_repeat_option_check check (repeat_option in ('none','daily','weekly','monthly','custom'));
alter table public.reminders drop constraint if exists reminders_custom_interval_check;
alter table public.reminders add constraint reminders_custom_interval_check
  check (repeat_option <> 'custom' or (repeat_interval_days is not null and repeat_interval_days between 1 and 365));

-- ============ ideas ============
alter table public.ideas add column if not exists description text;
alter table public.ideas add column if not exists category text;
alter table public.ideas add column if not exists potential text;
alter table public.ideas add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.ideas add column if not exists ai_validation text;
alter table public.ideas add column if not exists ai_validated_at timestamptz;
alter table public.ideas drop constraint if exists ideas_potential_check;
alter table public.ideas add constraint ideas_potential_check check (potential is null or potential in ('low','medium','high'));
alter table public.ideas drop constraint if exists ideas_status_check;
-- V1 -> V2 status mapping: new->idea, building->active, launched->completed, archived->paused. exploring is unchanged.
update public.ideas set status = case status
  when 'new' then 'idea' when 'building' then 'active' when 'launched' then 'completed' when 'archived' then 'paused' else status end;
alter table public.ideas add constraint ideas_status_check
  check (status in ('idea','exploring','validating','active','paused','rejected','completed'));
alter table public.ideas alter column status set default 'idea';

-- ============ learning ============
alter table public.learning_items add column if not exists status text;
alter table public.learning_items add column if not exists resources text;
update public.learning_items set status = case when progress >= 100 then 'completed' when progress > 0 then 'learning' else 'not_started' end
  where status is null;
alter table public.learning_items alter column status set default 'not_started';
alter table public.learning_items alter column status set not null;
alter table public.learning_items drop constraint if exists learning_items_status_check;
alter table public.learning_items add constraint learning_items_status_check check (status in ('not_started','learning','completed'));

create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  learning_item_id uuid not null references public.learning_items(id) on delete cascade,
  session_date date not null default current_date,
  minutes integer not null check (minutes between 1 and 1440),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists study_sessions_idx on public.study_sessions (user_id, session_date desc);

-- ============ notes ============
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) > 0),
  content text,
  category text,
  tags text[] not null default '{}',
  pinned boolean not null default false,
  archived boolean not null default false,
  project_id uuid references public.projects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notes_user_idx on public.notes (user_id, archived, pinned, updated_at desc);

-- ============ finance ============
alter table public.income add column if not exists currency text not null default 'TZS';
alter table public.expenses add column if not exists currency text not null default 'TZS';
alter table public.income drop constraint if exists income_currency_check;
alter table public.income add constraint income_currency_check check (char_length(currency) = 3);
alter table public.expenses drop constraint if exists expenses_currency_check;
alter table public.expenses add constraint expenses_currency_check check (char_length(currency) = 3);
-- Custom categories are allowed, so the fixed V1 category list is replaced by a "not blank" rule.
alter table public.expenses drop constraint if exists expenses_category_check;
alter table public.expenses drop constraint if exists expenses_category_not_blank;
alter table public.expenses add constraint expenses_category_not_blank check (char_length(btrim(category)) > 0);

create table if not exists public.finance_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  kind text not null check (kind in ('expense','income')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists finance_categories_unique on public.finance_categories (user_id, lower(name), kind);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category text not null check (char_length(btrim(category)) > 0),
  month date not null check (month = date_trunc('month', month::timestamp)::date),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'TZS' check (char_length(currency) = 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category, month)
);

create table if not exists public.financial_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  target_amount numeric(14,2) not null check (target_amount > 0),
  current_amount numeric(14,2) not null default 0 check (current_amount >= 0),
  target_date date,
  notes text,
  status text not null default 'active' check (status in ('active','completed','paused')),
  currency text not null default 'TZS' check (char_length(currency) = 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recurring_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('income','expense')),
  amount numeric(14,2) not null check (amount > 0),
  category text,
  source text,
  notes text,
  frequency text not null check (frequency in ('daily','weekly','monthly')),
  next_date date not null,
  end_date date,
  is_active boolean not null default true,
  currency text not null default 'TZS' check (char_length(currency) = 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'income' or (category is not null and char_length(btrim(category)) > 0))
);
create index if not exists recurring_due_idx on public.recurring_transactions (user_id, is_active, next_date);

-- ============ notifications (in-app notification center) ============
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null check (type in ('reminder','overdue_task','budget','goal_deadline','learning','ai')),
  title text not null,
  body text,
  link text,
  is_read boolean not null default false,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index if not exists notifications_user_idx on public.notifications (user_id, is_read, created_at desc);

-- ============ AI: conversations, messages, action requests ============
create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'New conversation' check (char_length(title) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_conversations_user_idx on public.ai_conversations (user_id, updated_at desc);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null check (char_length(content) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_messages_conv_idx on public.ai_messages (conversation_id, created_at);

create table if not exists public.ai_action_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversation_id uuid references public.ai_conversations(id) on delete cascade,
  action_type text not null,
  payload jsonb not null,
  summary text not null,
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled','failed')),
  error text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists ai_actions_conv_idx on public.ai_action_requests (conversation_id, created_at);

-- ============ ownership of linked records ============
-- A foreign key alone would let a row point at ANOTHER user's record if its id were known.
-- This trigger makes sure every link (goal_id, project_id, ...) points at a record the same user owns.
create or replace function public.enforce_owner_link()
returns trigger language plpgsql set search_path = public as $$
declare
  ref_table text := tg_argv[0];
  ref_col text := tg_argv[1];
  ref_id uuid := nullif(to_jsonb(new) ->> tg_argv[1], '')::uuid;
  ok boolean;
begin
  if ref_id is null then return new; end if;
  execute format('select exists (select 1 from public.%I where id = $1 and user_id = $2)', ref_table)
    into ok using ref_id, new.user_id;
  if not ok then raise exception 'Linked record not found'; end if;
  return new;
end;
$$;

do $$
declare
  link record;
begin
  for link in
    select * from (values
      ('milestones','goals','goal_id'),
      ('tasks','goals','goal_id'),
      ('tasks','projects','project_id'),
      ('goals','projects','project_id'),
      ('ideas','projects','project_id'),
      ('notes','projects','project_id'),
      ('reminders','tasks','task_id'),
      ('reminders','goals','goal_id'),
      ('study_sessions','learning_items','learning_item_id'),
      ('ai_messages','ai_conversations','conversation_id'),
      ('ai_action_requests','ai_conversations','conversation_id')
    ) as t(child, parent, col)
  loop
    execute format('drop trigger if exists enforce_link_%s on public.%I', link.col, link.child);
    execute format(
      'create trigger enforce_link_%s before insert or update on public.%I for each row execute function public.enforce_owner_link(%L, %L)',
      link.col, link.child, link.parent, link.col);
  end loop;
end
$$;

-- ============ RLS + updated_at for every new table ============
do $$
declare
  t text;
begin
  foreach t in array array['projects','milestones','study_sessions','notes','finance_categories','budgets',
                           'financial_goals','recurring_transactions','notifications',
                           'ai_conversations','ai_messages','ai_action_requests']
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

-- ============ finance functions (run with the caller's rights, so RLS applies) ============
-- Totals are computed in the database because the API returns at most 1000 rows per request.
create or replace function public.finance_totals()
returns table (total_income numeric, total_expenses numeric)
language sql stable security invoker set search_path = public as $$
  select coalesce((select sum(amount) from public.income where user_id = auth.uid()), 0),
         coalesce((select sum(amount) from public.expenses where user_id = auth.uid()), 0)
$$;

create or replace function public.finance_monthly(p_months integer default 6, p_today date default current_date)
returns table (month date, income numeric, expenses numeric)
language sql stable security invoker set search_path = public as $$
  with months as (
    select (date_trunc('month', p_today::timestamp) - make_interval(months => g))::date as month
    from generate_series(0, greatest(least(p_months, 36), 1) - 1) g
  )
  select m.month,
    coalesce((select sum(i.amount) from public.income i
              where i.user_id = auth.uid() and i.entry_date >= m.month
                and i.entry_date < (m.month + interval '1 month')::date), 0),
    coalesce((select sum(e.amount) from public.expenses e
              where e.user_id = auth.uid() and e.entry_date >= m.month
                and e.entry_date < (m.month + interval '1 month')::date), 0)
  from months m order by m.month
$$;

create or replace function public.finance_expense_by_category(p_from date, p_to date)
returns table (category text, total numeric)
language sql stable security invoker set search_path = public as $$
  select e.category, sum(e.amount) as total
  from public.expenses e
  where e.user_id = auth.uid() and e.entry_date >= p_from and e.entry_date < p_to
  group by e.category order by total desc
$$;

-- Creates the income/expense rows that are due and moves next_date forward. Safe to call repeatedly.
create or replace function public.process_recurring(p_today date default current_date)
returns integer
language plpgsql security invoker set search_path = public as $$
declare
  r record;
  d date;
  made integer := 0;
  guard integer;
begin
  for r in
    select * from public.recurring_transactions
    where user_id = auth.uid() and is_active and next_date <= p_today
      and (end_date is null or next_date <= end_date)
    for update skip locked
  loop
    d := r.next_date;
    guard := 0;
    while d <= p_today and (r.end_date is null or d <= r.end_date) and guard < 400 loop
      if r.kind = 'income' then
        insert into public.income (amount, source, category, entry_date, notes, currency)
        values (r.amount, r.source, r.category, d, r.notes, r.currency);
      else
        insert into public.expenses (amount, category, entry_date, notes, currency)
        values (r.amount, r.category, d, r.notes, r.currency);
      end if;
      made := made + 1;
      guard := guard + 1;
      d := case r.frequency
             when 'daily' then d + 1
             when 'weekly' then d + 7
             else (d + interval '1 month')::date
           end;
    end loop;
    update public.recurring_transactions
      set next_date = d,
          is_active = not (r.end_date is not null and d > r.end_date)
      where id = r.id;
  end loop;
  return made;
end;
$$;

revoke all on function public.finance_totals() from public, anon;
revoke all on function public.finance_monthly(integer, date) from public, anon;
revoke all on function public.finance_expense_by_category(date, date) from public, anon;
revoke all on function public.process_recurring(date) from public, anon;
grant execute on function public.finance_totals() to authenticated;
grant execute on function public.finance_monthly(integer, date) to authenticated;
grant execute on function public.finance_expense_by_category(date, date) to authenticated;
grant execute on function public.process_recurring(date) to authenticated;

revoke all on all tables in schema public from anon;
