-- Personal Life OS - V1 schema
-- Run this whole file once in Supabase -> SQL Editor.
-- Every user-owned table has user_id and Row Level Security: a user can only touch rows where user_id = auth.uid().

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- profiles ----------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  currency text not null default 'USD',
  notifications_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, full_name)
  values (new.id, nullif(new.raw_user_meta_data->>'full_name', ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- tasks ----------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) > 0),
  notes text,
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  category text not null default 'personal' check (category in ('personal','business','learning','finance','health','other')),
  due_date date,
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_user_due_idx on public.tasks (user_id, completed, due_date);

-- ---------- schedule_events ----------
create table if not exists public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) > 0),
  description text,
  category text not null default 'personal' check (category in ('personal','business','learning','finance','health','other')),
  event_date date not null,
  start_time time not null,
  end_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time is null or end_time > start_time)
);
create index if not exists schedule_user_date_idx on public.schedule_events (user_id, event_date, start_time);

-- ---------- goals ----------
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  description text,
  category text not null default 'personal' check (category in ('personal','business','financial','learning','other')),
  target_date date,
  progress integer not null default 0 check (progress between 0 and 100),
  status text not null default 'not_started' check (status in ('not_started','in_progress','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists goals_user_status_idx on public.goals (user_id, status);

-- ---------- ideas ----------
create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) > 0),
  problem text,
  proposed_solution text,
  target_users text,
  business_opportunity text,
  notes text,
  next_action text,
  status text not null default 'new' check (status in ('new','exploring','building','launched','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ideas_user_created_idx on public.ideas (user_id, created_at desc);

-- ---------- learning_items ----------
create table if not exists public.learning_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  topic text not null check (char_length(btrim(topic)) > 0),
  description text,
  notes text,
  source text,
  learning_goal text,
  progress integer not null default 0 check (progress between 0 and 100),
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists learning_user_idx on public.learning_items (user_id, progress);

-- ---------- income ----------
create table if not exists public.income (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  source text,
  category text,
  entry_date date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists income_user_date_idx on public.income (user_id, entry_date desc);

-- ---------- expenses ----------
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  category text not null default 'other' check (category in ('food','transport','bills','business','education','shopping','family','other')),
  entry_date date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expenses_user_date_idx on public.expenses (user_id, entry_date desc);

-- ---------- reminders ----------
-- Foundation only: stores reminders and repeat rules. Push delivery comes in a later phase.
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) > 0),
  description text,
  remind_date date not null,
  remind_time time,
  repeat_option text not null default 'none' check (repeat_option in ('none','daily','weekly','monthly')),
  is_done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reminders_user_date_idx on public.reminders (user_id, is_done, remind_date);

-- ---------- RLS + updated_at triggers ----------
do $$
declare
  t text;
begin
  foreach t in array array['profiles','tasks','schedule_events','goals','ideas','learning_items','income','expenses','reminders']
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

-- Defense in depth: anonymous (logged-out) clients get no table access at all.
revoke all on all tables in schema public from anon;
