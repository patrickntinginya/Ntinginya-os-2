-- Personal Life OS - V5 migration (additive). Run AFTER 001, 002 and 003, once, in the Supabase SQL editor.
-- Adds: Smart Reflection Log (reflections) and Habit Safe Mode (habit_safe_mode + habit_entries.safe_mode).
-- It never drops a table or deletes user data. Safe to run twice (everything is "if not exists" / re-created).

-- ============ reflections (private journal) ============
create table if not exists public.reflections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_date date not null default current_date,
  kind text not null default 'daily' check (kind in ('daily','calm')),
  mood smallint check (mood between 1 and 5),
  energy smallint check (energy between 1 and 5),
  went_well text check (char_length(went_well) <= 4000),
  difficult text check (char_length(difficult) <= 4000),
  tomorrow_action text check (char_length(tomorrow_action) <= 500),
  note text check (char_length(note) <= 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reflections_user_date_idx on public.reflections (user_id, entry_date desc, created_at desc);

-- ============ habit safe mode ============
-- A temporary smaller version of a habit. History in habit_entries is never touched; this table only records the plan.
create table if not exists public.habit_safe_mode (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  mini_version text not null check (char_length(btrim(mini_version)) between 1 and 200),
  recovery_note text check (char_length(recovery_note) <= 500),
  started_on date not null default current_date,
  planned_end date,
  exited_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists habit_safe_mode_user_idx on public.habit_safe_mode (user_id, habit_id);
-- At most one ACTIVE safe-mode plan per habit.
create unique index if not exists habit_safe_mode_one_active on public.habit_safe_mode (habit_id) where exited_on is null;

-- A completion made in Safe Mode is flagged, so the app can show it honestly. Old rows default to false.
alter table public.habit_entries add column if not exists safe_mode boolean not null default false;

-- ============ RLS (owner only) + updated_at ============
do $$
declare
  t text;
begin
  foreach t in array array['reflections','habit_safe_mode']
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

-- The habit a safe-mode plan points at must belong to the same user (reuses the V2 trigger function).
drop trigger if exists enforce_link_habit_id on public.habit_safe_mode;
create trigger enforce_link_habit_id before insert or update on public.habit_safe_mode
  for each row execute function public.enforce_owner_link('habits', 'habit_id');

revoke all on public.reflections, public.habit_safe_mode from anon;
