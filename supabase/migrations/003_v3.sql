-- Personal Life OS - V3 migration (additive). Run AFTER 001 and 002, once, in the Supabase SQL editor.
-- Adds habits, links between goals/projects/ideas/notes/tasks, AI on/off switch, extra notification types,
-- account deletion. It never drops a table or deletes user data.

-- ============ profiles ============
alter table public.profiles add column if not exists ai_enabled boolean not null default true;

-- ============ habits ============
create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text,
  -- 0 = Sunday ... 6 = Saturday. The habit is "due" on these weekdays.
  days_of_week smallint[] not null default '{0,1,2,3,4,5,6}'
    check (cardinality(days_of_week) between 1 and 7 and days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]),
  start_date date not null default current_date,
  reminder_time time,
  goal_id uuid references public.goals(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists habits_user_idx on public.habits (user_id, archived_at);

create table if not exists public.habit_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  entry_date date not null check (entry_date <= current_date + 1),
  note text,
  created_at timestamptz not null default now(),
  unique (habit_id, entry_date)
);
create index if not exists habit_entries_user_date_idx on public.habit_entries (user_id, entry_date desc);

-- ============ relationships (Second Brain / Goal -> Project -> Task) ============
alter table public.projects add column if not exists goal_id uuid references public.goals(id) on delete set null;
alter table public.projects add column if not exists source_idea_id uuid references public.ideas(id) on delete set null;
alter table public.projects add column if not exists source_note_id uuid references public.notes(id) on delete set null;
-- Set only by the "Create project from goal" button. A goal can still have several projects (goal_id); this makes the button idempotent.
alter table public.projects add column if not exists source_goal_id uuid references public.goals(id) on delete set null;
alter table public.tasks add column if not exists source_idea_id uuid references public.ideas(id) on delete set null;
alter table public.tasks add column if not exists source_note_id uuid references public.notes(id) on delete set null;
alter table public.goals add column if not exists source_learning_id uuid references public.learning_items(id) on delete set null;

-- One conversion per source: converting the same idea/note/topic twice cannot create a duplicate.
create unique index if not exists projects_source_idea_uniq on public.projects (source_idea_id) where source_idea_id is not null;
create unique index if not exists projects_source_goal_uniq on public.projects (source_goal_id) where source_goal_id is not null;
create unique index if not exists projects_source_note_uniq on public.projects (source_note_id) where source_note_id is not null;
create unique index if not exists tasks_source_idea_uniq on public.tasks (source_idea_id) where source_idea_id is not null;
create unique index if not exists tasks_source_note_uniq on public.tasks (source_note_id) where source_note_id is not null;
create unique index if not exists goals_source_learning_uniq on public.goals (source_learning_id) where source_learning_id is not null;
create index if not exists projects_goal_idx on public.projects (goal_id);
create index if not exists tasks_user_status_due_idx on public.tasks (user_id, status, due_date);

-- ============ notifications: more types ============
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('reminder','overdue_task','budget','goal_deadline','learning','ai','habit','project','briefing','weekly_review'));

-- ============ ownership of links (reuses the V2 trigger function) ============
do $$
declare
  link record;
begin
  for link in
    select * from (values
      ('habits','goals','goal_id'),
      ('habit_entries','habits','habit_id'),
      ('projects','goals','goal_id'),
      ('projects','goals','source_goal_id'),
      ('projects','ideas','source_idea_id'),
      ('projects','notes','source_note_id'),
      ('tasks','ideas','source_idea_id'),
      ('tasks','notes','source_note_id'),
      ('goals','learning_items','source_learning_id')
    ) as t(child, parent, col)
  loop
    execute format('drop trigger if exists enforce_link_%s on public.%I', link.col, link.child);
    execute format(
      'create trigger enforce_link_%s before insert or update on public.%I for each row execute function public.enforce_owner_link(%L, %L)',
      link.col, link.child, link.parent, link.col);
  end loop;
end
$$;

-- ============ RLS for the new tables ============
do $$
declare
  t text;
begin
  foreach t in array array['habits','habit_entries']
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
  end loop;
end
$$;
drop trigger if exists set_updated_at on public.habits;
create trigger set_updated_at before update on public.habits for each row execute function public.set_updated_at();

-- ============ account deletion ============
-- Deletes the signed-in user's account. Every user-owned table references auth.users with ON DELETE CASCADE,
-- so all of that user's data goes with it. Only ever acts on auth.uid(); it takes no user id argument.
create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

revoke all on all tables in schema public from anon;
