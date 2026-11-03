-- Professionals marketplace and free appointment requests. Additive only.
-- Administrators are identified by the existing app_metadata-only Community guard.

create table if not exists public.marketplace_professionals (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 100),
  category text not null check (category in ('health','education','home_services','technology','business','beauty','wellness','legal','other')),
  skills text[] not null default '{}' check (cardinality(skills) <= 20),
  experience_years integer not null check (experience_years between 0 and 60),
  location text not null check (char_length(btrim(location)) between 2 and 120),
  description text not null check (char_length(btrim(description)) between 20 and 2000),
  photo_path text not null check (char_length(photo_path) <= 300 and split_part(photo_path, '/', 1) = user_id::text),
  status text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  verified_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text check (review_note is null or char_length(review_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists marketplace_professionals_discovery_idx
  on public.marketplace_professionals (category, lower(location), created_at desc)
  where status = 'approved';

create table if not exists public.marketplace_services (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.marketplace_professionals(user_id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 120),
  category text not null check (category in ('health','education','home_services','technology','business','beauty','wellness','legal','other')),
  description text not null check (char_length(btrim(description)) between 20 and 2000),
  price_tzs numeric(12,2) check (price_tzs is null or price_tzs >= 0),
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 480),
  status text not null default 'pending' check (status in ('pending','active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (professional_id = user_id)
);
create index if not exists marketplace_services_discovery_idx
  on public.marketplace_services (category, professional_id)
  where status = 'active';

create table if not exists public.marketplace_appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  professional_id uuid not null references public.marketplace_professionals(user_id) on delete cascade,
  service_id uuid not null references public.marketplace_services(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  message text check (message is null or char_length(message) <= 1000),
  status text not null default 'pending' check (status in ('pending','accepted','rejected','cancelled','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id <> professional_id),
  check (ends_at > starts_at)
);
create index if not exists marketplace_appointments_client_idx
  on public.marketplace_appointments (user_id, starts_at desc);
create index if not exists marketplace_appointments_professional_idx
  on public.marketplace_appointments (professional_id, starts_at);
create index if not exists marketplace_appointments_conflict_idx
  on public.marketplace_appointments (professional_id, starts_at, ends_at)
  where status = 'accepted';

alter table public.marketplace_professionals enable row level security;
alter table public.marketplace_services enable row level security;
alter table public.marketplace_appointments enable row level security;
revoke all on public.marketplace_professionals, public.marketplace_services, public.marketplace_appointments from public, anon;
grant select, insert, update on public.marketplace_professionals to authenticated;
grant select, insert, update, delete on public.marketplace_services to authenticated;
grant select, insert, update on public.marketplace_appointments to authenticated;

drop policy if exists marketplace_professionals_select on public.marketplace_professionals;
create policy marketplace_professionals_select on public.marketplace_professionals for select to authenticated
  using (status = 'approved' or user_id = (select auth.uid()) or public.community_is_admin());
drop policy if exists marketplace_professionals_insert on public.marketplace_professionals;
create policy marketplace_professionals_insert on public.marketplace_professionals for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending' and verified_at is null and reviewed_by is null);
drop policy if exists marketplace_professionals_update on public.marketplace_professionals;
create policy marketplace_professionals_update on public.marketplace_professionals for update to authenticated
  using (user_id = (select auth.uid()) or public.community_is_admin())
  with check (user_id = (select auth.uid()) or public.community_is_admin());

drop policy if exists marketplace_services_select on public.marketplace_services;
create policy marketplace_services_select on public.marketplace_services for select to authenticated
  using (
    (status = 'active' and exists (
      select 1 from public.marketplace_professionals p
      where p.user_id = professional_id and p.status = 'approved'
    ))
    or user_id = (select auth.uid())
    or public.community_is_admin()
  );
drop policy if exists marketplace_services_insert on public.marketplace_services;
create policy marketplace_services_insert on public.marketplace_services for insert to authenticated
  with check (
    user_id = (select auth.uid()) and professional_id = (select auth.uid()) and status = 'pending'
  );
drop policy if exists marketplace_services_update on public.marketplace_services;
create policy marketplace_services_update on public.marketplace_services for update to authenticated
  using (user_id = (select auth.uid()) or public.community_is_admin())
  with check (user_id = (select auth.uid()) or public.community_is_admin());
drop policy if exists marketplace_services_delete on public.marketplace_services;
create policy marketplace_services_delete on public.marketplace_services for delete to authenticated
  using (user_id = (select auth.uid()) or public.community_is_admin());

drop policy if exists marketplace_appointments_select on public.marketplace_appointments;
create policy marketplace_appointments_select on public.marketplace_appointments for select to authenticated
  using (user_id = (select auth.uid()) or professional_id = (select auth.uid()) or public.community_is_admin());
drop policy if exists marketplace_appointments_insert on public.marketplace_appointments;
create policy marketplace_appointments_insert on public.marketplace_appointments for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending');
drop policy if exists marketplace_appointments_update on public.marketplace_appointments;
create policy marketplace_appointments_update on public.marketplace_appointments for update to authenticated
  using (user_id = (select auth.uid()) or professional_id = (select auth.uid()) or public.community_is_admin())
  with check (user_id = (select auth.uid()) or professional_id = (select auth.uid()) or public.community_is_admin());

create or replace function public.marketplace_guard_professional()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare admin boolean := public.community_is_admin(); photo_metadata jsonb; profile_changed boolean;
begin
  if tg_op = 'INSERT' then
    if not admin and (
      new.user_id is distinct from auth.uid()
      or new.status <> 'pending'
      or new.verified_at is not null
      or new.reviewed_by is not null
    ) then raise exception 'professional_review_required' using errcode = '42501'; end if;
    select o.metadata into photo_metadata from storage.objects o
    where o.bucket_id = 'professional-media' and o.name = new.photo_path;
    if not found
      or coalesce(photo_metadata ->> 'mimetype', '') not in ('image/jpeg','image/png','image/webp')
      or not (case
        when coalesce(photo_metadata ->> 'size', '') ~ '^[0-9]+$'
        then (photo_metadata ->> 'size')::bigint between 1 and 5242880
        else false
      end)
    then raise exception 'professional_photo_invalid' using errcode = '23514'; end if;
    return new;
  end if;

  if new.user_id is distinct from old.user_id then raise exception 'professional_owner_immutable' using errcode = '42501'; end if;
  if new.photo_path is distinct from old.photo_path then
    select o.metadata into photo_metadata from storage.objects o
    where o.bucket_id = 'professional-media' and o.name = new.photo_path;
    if not found
      or coalesce(photo_metadata ->> 'mimetype', '') not in ('image/jpeg','image/png','image/webp')
      or not (case
        when coalesce(photo_metadata ->> 'size', '') ~ '^[0-9]+$'
        then (photo_metadata ->> 'size')::bigint between 1 and 5242880
        else false
      end)
    then raise exception 'professional_photo_invalid' using errcode = '23514'; end if;
  end if;
  if not admin then
    if old.status = 'suspended' then raise exception 'professional_review_required' using errcode = '42501'; end if;
    profile_changed := new.display_name is distinct from old.display_name
      or new.category is distinct from old.category
      or new.skills is distinct from old.skills
      or new.experience_years is distinct from old.experience_years
      or new.location is distinct from old.location
      or new.description is distinct from old.description
      or new.photo_path is distinct from old.photo_path;
    if old.status = 'approved' and profile_changed then
      new.status := 'pending';
      new.verified_at := null;
      new.reviewed_by := null;
      new.review_note := null;
    end if;
    if new.status is distinct from old.status
      and not (old.status in ('rejected', 'approved') and new.status = 'pending')
    then raise exception 'professional_review_required' using errcode = '42501'; end if;
    if (
        (new.verified_at is distinct from old.verified_at or new.reviewed_by is distinct from old.reviewed_by)
        and not (old.status = 'approved' and profile_changed and new.status = 'pending')
      )
      or (new.review_note is distinct from old.review_note and not (old.status in ('rejected', 'approved') and new.status = 'pending'))
    then raise exception 'professional_review_required' using errcode = '42501'; end if;
    if old.status = 'rejected' and new.status = 'pending' then new.review_note := null; end if;
  elsif new.status is distinct from old.status then
    if new.status = 'approved' and new.user_id = auth.uid() then
      raise exception 'professional_self_approval' using errcode = '42501';
    end if;
    new.reviewed_by := auth.uid();
    new.verified_at := case when new.status = 'approved' then now() else null end;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists marketplace_professional_guard on public.marketplace_professionals;
create trigger marketplace_professional_guard before insert or update on public.marketplace_professionals
  for each row execute function public.marketplace_guard_professional();

create or replace function public.marketplace_guard_service()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare admin boolean := public.community_is_admin(); professional_status text;
begin
  if tg_op = 'INSERT' then
    if not admin and (
      new.user_id is distinct from auth.uid()
      or new.professional_id is distinct from auth.uid()
      or new.status <> 'pending'
    ) then raise exception 'service_review_required' using errcode = '42501'; end if;
  else
    if new.user_id is distinct from old.user_id or new.professional_id is distinct from old.professional_id then
      raise exception 'service_owner_immutable' using errcode = '42501';
    end if;
    if not admin and (old.status = 'suspended' or new.status is distinct from old.status) then
      raise exception 'service_review_required' using errcode = '42501';
    end if;
    if not admin and old.status = 'active' and (
      new.title is distinct from old.title
      or new.category is distinct from old.category
      or new.description is distinct from old.description
      or new.price_tzs is distinct from old.price_tzs
      or new.duration_minutes is distinct from old.duration_minutes
    ) then
      new.status := 'pending';
    end if;
    new.updated_at := now();
  end if;

  if new.status = 'active' then
    select p.status into professional_status
    from public.marketplace_professionals p
    where p.user_id = new.professional_id;
    if professional_status is distinct from 'approved' then
      raise exception 'professional_not_approved' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists marketplace_service_guard on public.marketplace_services;
create trigger marketplace_service_guard before insert or update on public.marketplace_services
  for each row execute function public.marketplace_guard_service();

create or replace function public.marketplace_guard_appointment()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare admin boolean := public.community_is_admin(); professional_status text; service_duration integer;
begin
  if tg_op = 'INSERT' then
    if new.user_id is distinct from auth.uid() or new.status <> 'pending' then
      raise exception 'appointment_request_only' using errcode = '42501';
    end if;
  else
    if new.user_id is distinct from old.user_id
      or new.professional_id is distinct from old.professional_id
      or new.service_id is distinct from old.service_id
      or new.starts_at is distinct from old.starts_at
      or new.ends_at is distinct from old.ends_at
      or new.message is distinct from old.message
    then raise exception 'appointment_details_immutable' using errcode = '42501'; end if;

    if new.status is distinct from old.status and not admin then
      if auth.uid() = old.user_id then
        if old.status not in ('pending','accepted') or new.status <> 'cancelled' then
          raise exception 'appointment_status_not_allowed' using errcode = '42501';
        end if;
      elsif auth.uid() = old.professional_id then
        if (old.status = 'pending' and new.status not in ('accepted','rejected','cancelled'))
          or (old.status = 'accepted' and new.status not in ('completed','cancelled'))
        then raise exception 'appointment_status_not_allowed' using errcode = '42501'; end if;
      else
        raise exception 'appointment_status_not_allowed' using errcode = '42501';
      end if;
    end if;
  end if;

  if new.status in ('pending','accepted') then
    perform pg_advisory_xact_lock(hashtextextended('marketplace-booking:' || new.professional_id::text, 0));
    select p.status into professional_status
    from public.marketplace_professionals p
    where p.user_id = new.professional_id;
    if professional_status is distinct from 'approved' then
      raise exception 'professional_not_available' using errcode = '23514';
    end if;

    select s.duration_minutes into service_duration
    from public.marketplace_services s
    where s.id = new.service_id
      and s.professional_id = new.professional_id
      and s.status = 'active';
    if service_duration is null then raise exception 'service_not_available' using errcode = '23514'; end if;
    if new.ends_at <> new.starts_at + make_interval(mins => service_duration) then
      raise exception 'appointment_duration_mismatch' using errcode = '23514';
    end if;
    if new.starts_at < now() + interval '15 minutes' then
      raise exception 'appointment_must_be_future' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.marketplace_appointments a
      where a.professional_id = new.professional_id
        and a.id is distinct from new.id
        and a.status = 'accepted'
        and a.starts_at < new.ends_at
        and a.ends_at > new.starts_at
    ) then raise exception 'appointment_time_conflict' using errcode = '23P01'; end if;
  end if;

  new.updated_at := now();
  return new;
end $$;
drop trigger if exists marketplace_appointment_guard on public.marketplace_appointments;
create trigger marketplace_appointment_guard before insert or update on public.marketplace_appointments
  for each row execute function public.marketplace_guard_appointment();

create or replace function public.marketplace_notify_appointment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare recipient uuid; current_status text; recipients uuid[];
begin
  current_status := new.status;
  if tg_op = 'INSERT' then
    recipients := array[new.professional_id];
  else
    if old.status is not distinct from new.status then return new; end if;
    recipients := array[new.user_id, new.professional_id];
  end if;

  foreach recipient in array recipients loop
    if recipient is not null and recipient is distinct from auth.uid() then
      insert into public.notifications (user_id, type, title, body, link, dedupe_key)
      values (
        recipient,
        'appointment',
        case when tg_op = 'INSERT' then 'New appointment request' else 'Appointment updated' end,
        case current_status
          when 'pending' then 'A free booking request is waiting for review.'
          when 'accepted' then 'Your appointment request was accepted.'
          when 'rejected' then 'Your appointment request was declined.'
          when 'cancelled' then 'An appointment was cancelled.'
          when 'completed' then 'An appointment was marked complete.'
        end,
        '/marketplace',
        'appointment:' || new.id::text || ':' || current_status || ':' || floor(extract(epoch from new.updated_at))::bigint::text
      ) on conflict (user_id, dedupe_key) do nothing;
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.marketplace_notify_appointment() from public, anon, authenticated;
drop trigger if exists marketplace_appointment_notify on public.marketplace_appointments;
create trigger marketplace_appointment_notify after insert or update of status on public.marketplace_appointments
  for each row execute function public.marketplace_notify_appointment();

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('reminder','overdue_task','budget','goal_deadline','learning','ai','habit','project','briefing','weekly_review',
                  'community','appointment','payment','subscription','security'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('professional-media', 'professional-media', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists professional_media_select on storage.objects;
create policy professional_media_select on storage.objects for select to authenticated using (
  bucket_id = 'professional-media'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.community_is_admin()
    or exists (
      select 1 from public.marketplace_professionals p
      where p.photo_path = name and p.status = 'approved'
    )
  )
);
drop policy if exists professional_media_insert on storage.objects;
create policy professional_media_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'professional-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
drop policy if exists professional_media_update on storage.objects;
create policy professional_media_update on storage.objects for update to authenticated using (
  bucket_id = 'professional-media' and (storage.foldername(name))[1] = (select auth.uid())::text
) with check (
  bucket_id = 'professional-media' and (storage.foldername(name))[1] = (select auth.uid())::text
);
drop policy if exists professional_media_delete on storage.objects;
create policy professional_media_delete on storage.objects for delete to authenticated using (
  bucket_id = 'professional-media'
  and ((storage.foldername(name))[1] = (select auth.uid())::text or public.community_is_admin())
);

comment on table public.marketplace_appointments is
  'Free booking requests only; any service payment arrangement happens outside the platform.';
comment on column public.marketplace_services.price_tzs is
  'Indicative TZS price only; no payment, commission, or payout is processed by the platform.';
