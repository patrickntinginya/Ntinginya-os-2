-- Personal Life OS Safe Mode media library.
-- Run once in Supabase SQL Editor after migrations 001-004. Additive only; no existing data is dropped.
create table if not exists public.safe_mode_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  media_type text not null check (media_type in ('image','audio','video')),
  visibility text not null default 'personal' check (visibility in ('personal','shared')),
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  created_at timestamptz not null default now(),
  check (
    (visibility = 'personal' and split_part(storage_path, '/', 1) = user_id::text)
    or (visibility = 'shared' and split_part(storage_path, '/', 1) = 'shared')
  )
);
create index if not exists safe_mode_media_visibility_created_idx on public.safe_mode_media (visibility, created_at desc);
create index if not exists safe_mode_media_user_created_idx on public.safe_mode_media (user_id, created_at desc);
alter table public.safe_mode_media enable row level security;

-- Admin rights must be assigned by a trusted Supabase administrator in Auth app_metadata, never user_metadata.
create or replace function public.safe_mode_is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('admin', 'owner');
$$;

revoke all on function public.safe_mode_is_admin() from public;
revoke all on function public.safe_mode_is_admin() from anon;
grant execute on function public.safe_mode_is_admin() to authenticated;

drop policy if exists safe_mode_media_select on public.safe_mode_media;
create policy safe_mode_media_select on public.safe_mode_media for select to authenticated
using (visibility = 'shared' or user_id = (select auth.uid()));
drop policy if exists safe_mode_media_insert on public.safe_mode_media;
create policy safe_mode_media_insert on public.safe_mode_media for insert to authenticated
with check (user_id = (select auth.uid()) and ((visibility = 'personal' and split_part(storage_path, '/', 1) = (select auth.uid())::text) or (visibility = 'shared' and split_part(storage_path, '/', 1) = 'shared' and public.safe_mode_is_admin())));
drop policy if exists safe_mode_media_update on public.safe_mode_media;
create policy safe_mode_media_update on public.safe_mode_media for update to authenticated
using ((user_id = (select auth.uid()) and visibility = 'personal') or public.safe_mode_is_admin())
with check ((user_id = (select auth.uid()) and visibility = 'personal') or public.safe_mode_is_admin());
drop policy if exists safe_mode_media_delete on public.safe_mode_media;
create policy safe_mode_media_delete on public.safe_mode_media for delete to authenticated
using ((user_id = (select auth.uid()) and visibility = 'personal') or public.safe_mode_is_admin());
revoke all on public.safe_mode_media from anon;
grant select, insert, update, delete on public.safe_mode_media to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('safe-mode-media', 'safe-mode-media', false, 52428800,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif','audio/mpeg','audio/mp4','audio/aac','audio/ogg','audio/wav','audio/webm','video/mp4','video/webm','video/quicktime','video/ogg'])
on conflict (id) do update set public = false, file_size_limit = 52428800, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists safe_mode_media_storage_select on storage.objects;
create policy safe_mode_media_storage_select on storage.objects for select to authenticated
using (bucket_id = 'safe-mode-media' and ((storage.foldername(name))[1] = (select auth.uid())::text or (storage.foldername(name))[1] = 'shared'));
drop policy if exists safe_mode_media_storage_insert on storage.objects;
create policy safe_mode_media_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'safe-mode-media' and ((storage.foldername(name))[1] = (select auth.uid())::text or ((storage.foldername(name))[1] = 'shared' and public.safe_mode_is_admin())));
drop policy if exists safe_mode_media_storage_update on storage.objects;
create policy safe_mode_media_storage_update on storage.objects for update to authenticated
using (bucket_id = 'safe-mode-media' and ((storage.foldername(name))[1] = (select auth.uid())::text or ((storage.foldername(name))[1] = 'shared' and public.safe_mode_is_admin())))
with check (bucket_id = 'safe-mode-media' and ((storage.foldername(name))[1] = (select auth.uid())::text or ((storage.foldername(name))[1] = 'shared' and public.safe_mode_is_admin())));
drop policy if exists safe_mode_media_storage_delete on storage.objects;
create policy safe_mode_media_storage_delete on storage.objects for delete to authenticated
using (bucket_id = 'safe-mode-media' and ((storage.foldername(name))[1] = (select auth.uid())::text or ((storage.foldername(name))[1] = 'shared' and public.safe_mode_is_admin())));
