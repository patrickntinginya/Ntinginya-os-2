create or replace function public.community_guard_status()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.status is distinct from old.status and not public.community_is_admin() then
    raise exception 'moderation_only';
  end if;

  if tg_table_name = 'community_profiles' then
    if new.suspended_reason is distinct from old.suspended_reason and not public.community_is_admin() then
      raise exception 'moderation_only';
    end if;
  elsif tg_table_name = 'community_reports' then
    if (new.resolved_by is distinct from old.resolved_by or new.resolution_note is distinct from old.resolution_note)
       and not public.community_is_admin() then
      raise exception 'moderation_only';
    end if;
  end if;
  return new;
end $$;

create or replace function public.voice_object_within_limits(p_bucket text, p_path text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  object_size text;
  object_mime text;
  parsed_size bigint;
begin
  select o.metadata ->> 'size', o.metadata ->> 'mimetype'
    into object_size, object_mime
    from storage.objects o
    where o.bucket_id = p_bucket and o.name = p_path;
  if not found or object_size is null or object_mime is null then return false; end if;
  if object_size !~ '^[0-9]+$' or object_mime not like 'audio/%' then return false; end if;
  parsed_size := object_size::bigint;
  return parsed_size between 1 and 5242880;
exception
  when numeric_value_out_of_range then return false;
end $$;
revoke all on function public.voice_object_within_limits(text, text) from public, anon, authenticated;

create or replace function public.voice_upload_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'chat_messages' then
    if new.kind = 'voice' and new.deleted_at is null then
      if new.sender_id is distinct from auth.uid()
         or new.media_path is null
         or new.media_path not like new.sender_id::text || '/' || new.conversation_id::text || '/%'
         or new.media_mime is null
         or new.media_mime not like 'audio/%'
         or not public.voice_object_within_limits('chat-media', new.media_path) then
        raise exception 'voice_file_invalid' using errcode = '22023';
      end if;
    end if;
  elsif tg_table_name = 'community_posts' or tg_table_name = 'community_comments' then
    if new.media_kind = 'voice' then
      if new.user_id is distinct from auth.uid()
         or new.media_path is null
         or new.media_path not like new.user_id::text || '/%'
         or new.media_mime is null
         or new.media_mime not like 'audio/%'
         or not public.voice_object_within_limits('community-media', new.media_path) then
        raise exception 'voice_file_invalid' using errcode = '22023';
      end if;
    end if;
  else
    raise exception 'unsupported_voice_upload_table' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function public.voice_upload_guard() from public, anon, authenticated;
