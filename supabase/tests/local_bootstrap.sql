-- Minimal stand-ins for the parts of Supabase that the migrations rely on, so migrations 001-021 and the RLS tests can run on a
-- PLAIN, DISPOSABLE PostgreSQL 17+ server (Docker). NEVER run this against a Supabase project: Supabase already provides all of it.
-- Provided here: roles anon/authenticated/service_role, auth.users, auth.uid(), auth.jwt(), storage.buckets, storage.objects, storage.foldername().
-- These mirror Supabase's documented behaviour; the real platform remains the final authority (see docs/DATABASE_VALIDATION.md).
create extension if not exists pgcrypto;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;
grant usage on schema public, auth, storage to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key,
  instance_id uuid,
  aud text,
  role text,
  email text,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Same lookup order as Supabase: the JSON claims set per request (PostgREST sets request.jwt.claims).
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true), (auth.jwt() ->> 'sub')), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(current_setting('request.jwt.claim.role', true), auth.jwt() ->> 'role')
$$;
grant execute on function auth.uid(), auth.jwt(), auth.role() to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key, name text not null unique, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
-- Supabase gives these roles table privileges and lets policies decide.
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;
-- Supabase's helper: the folder parts of a path (everything except the file name).
create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- Supabase grants new public objects to the API roles by default and lets RLS decide; the migrations then REVOKE what must stay closed.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
