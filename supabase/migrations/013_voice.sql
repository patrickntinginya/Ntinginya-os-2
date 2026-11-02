-- V6: voice posts and voice comments in Community, and a stored-size check for every voice upload. Run after 012. Additive.
--
--  * community_posts: media_kind may now be 'voice' (+ duration_ms, media_size). Limits are enforced HERE, not only in the app:
--    <= 5 minutes, <= 5 MB, an audio MIME type, duration required.
--  * community_comments: optional voice attachment (media_kind='voice', media_path, media_mime, duration_ms, media_size). A voice comment may have no text.
--  * the community-media bucket accepts the audio container types the recorder produces.
--  * community_can_read_media() also covers comment voice, with exactly the same visibility rules as the post it belongs to
--    (visible post, visible comment, not blocked, private-group membership).
--  * voice_object_within_limits(): the numbers the CLIENT states (media_size) could be false, so before a voice row is stored the REAL size and type of the uploaded
--    object are read from Storage's own metadata. It rejects only when the metadata shows a violation; if the object or a metadata key is missing it does not
--    block (fail-open on purpose, so a platform detail can never break sending). Works for chat voice messages as well.

-- ---------------------------------------------------------------- posts
alter table public.community_posts add column if not exists duration_ms integer;
alter table public.community_posts add column if not exists media_size bigint;
alter table public.community_posts drop constraint if exists community_posts_media_kind_check;
alter table public.community_posts add constraint community_posts_media_kind_check check (media_kind is null or media_kind in ('image','video','voice'));
alter table public.community_posts drop constraint if exists community_posts_voice_limits;
alter table public.community_posts add constraint community_posts_voice_limits check (
  media_kind is distinct from 'voice'
  or (duration_ms between 500 and 300000 and media_size between 1 and 5242880 and media_mime like 'audio/%')
);

-- ---------------------------------------------------------------- comments
alter table public.community_comments add column if not exists media_kind text;
alter table public.community_comments add column if not exists media_path text;
alter table public.community_comments add column if not exists media_mime text;
alter table public.community_comments add column if not exists duration_ms integer;
alter table public.community_comments add column if not exists media_size bigint;
alter table public.community_comments alter column body set default '';
alter table public.community_comments drop constraint if exists community_comments_body_check;
alter table public.community_comments drop constraint if exists community_comments_content;
alter table public.community_comments add constraint community_comments_content check (char_length(body) <= 1000 and (char_length(btrim(body)) >= 1 or media_path is not null));
alter table public.community_comments drop constraint if exists community_comments_media;
alter table public.community_comments add constraint community_comments_media check (
  (media_kind is null) = (media_path is null)
  and (media_kind is null or media_kind = 'voice')
  and (media_path is null or (char_length(media_path) <= 300 and split_part(media_path, '/', 1) = user_id::text))
);
alter table public.community_comments drop constraint if exists community_comments_voice_limits;
alter table public.community_comments add constraint community_comments_voice_limits check (
  media_kind is null
  or (duration_ms between 500 and 300000 and media_size between 1 and 5242880 and media_mime like 'audio/%')
);
create index if not exists community_comments_media_idx on public.community_comments (media_path) where media_path is not null;

-- ---------------------------------------------------------------- feed view: the same columns as 007, new ones appended at the END (required by CREATE OR REPLACE VIEW)
create or replace view public.community_feed with (security_invoker = true) as
select
  p.id, p.user_id, p.group_id, p.body, p.media_kind, p.media_path, p.media_mime, p.allow_comments, p.status, p.created_at,
  cp.display_name as author_name,
  cp.avatar_path as author_avatar,
  g.name as group_name,
  (select count(*) from public.community_reactions r where r.post_id = p.id) as reaction_count,
  (select count(*) from public.community_comments c where c.post_id = p.id and c.status = 'visible') as comment_count,
  (select r.kind from public.community_reactions r where r.post_id = p.id and r.user_id = auth.uid()) as my_reaction,
  ((select count(*) from public.community_reactions r where r.post_id = p.id and r.created_at > now() - interval '7 days')
   + 2 * (select count(*) from public.community_comments c where c.post_id = p.id and c.status = 'visible' and c.created_at > now() - interval '7 days')) as trend_score,
  p.duration_ms
from public.community_posts p
left join public.community_profiles cp on cp.user_id = p.user_id
left join public.community_groups g on g.id = p.group_id;

-- ---------------------------------------------------------------- bucket: audio containers produced by MediaRecorder (Chrome/Edge/Firefox/Android: webm, ogg; Safari/iOS: mp4)
update storage.buckets
   set allowed_mime_types = (select array_agg(distinct m) from unnest(coalesce(allowed_mime_types, '{}') || array['audio/webm','audio/ogg','audio/mp4','audio/aac']) m)
 where id = 'community-media';

-- ---------------------------------------------------------------- who may read community media (009 + comment voice)
create or replace function public.community_can_read_media(obj_name text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select
    auth.uid() is not null and (
      (storage.foldername(obj_name))[1] = auth.uid()::text
      or public.community_is_admin()
      or exists (
        select 1 from public.community_posts p
        where p.media_path = obj_name
          and p.status = 'visible'
          and not public.community_blocked(p.user_id)
          and (
            p.group_id is null
            or public.community_is_group_member(p.group_id)
            or exists (select 1 from public.community_groups g where g.id = p.group_id and g.privacy = 'public' and g.status = 'active')
          )
      )
      or exists (
        select 1 from public.community_comments c
        join public.community_posts p on p.id = c.post_id
        where c.media_path = obj_name
          and c.status = 'visible'
          and not public.community_blocked(c.user_id)
          and p.status = 'visible'
          and not public.community_blocked(p.user_id)
          and (
            p.group_id is null
            or public.community_is_group_member(p.group_id)
            or exists (select 1 from public.community_groups g where g.id = p.group_id and g.privacy = 'public' and g.status = 'active')
          )
      )
      or exists (
        select 1 from public.community_profiles pr
        where pr.avatar_path = obj_name
          and pr.status = 'active'
          and not public.community_blocked(pr.user_id)
      )
    );
$$;
revoke all on function public.community_can_read_media(text) from public, anon;
grant execute on function public.community_can_read_media(text) to authenticated;

-- ---------------------------------------------------------------- real stored size / type of a voice upload
create or replace function public.voice_object_within_limits(p_bucket text, p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from storage.objects o
    where o.bucket_id = p_bucket and o.name = p_path
      and (
        (o.metadata ? 'size' and (o.metadata ->> 'size') ~ '^[0-9]+$' and (o.metadata ->> 'size')::bigint > 5242880)
        or (o.metadata ? 'mimetype' and (o.metadata ->> 'mimetype') not like 'audio/%')
      )
  )
$$;
revoke all on function public.voice_object_within_limits(text, text) from public, anon, authenticated; -- internal: only the triggers below call it

create or replace function public.voice_upload_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'chat_messages' and new.kind = 'voice' and new.deleted_at is null then
    if not public.voice_object_within_limits('chat-media', new.media_path) then raise exception 'voice_file_invalid' using errcode = '22023'; end if;
  elsif tg_table_name in ('community_posts', 'community_comments') and new.media_kind = 'voice' then
    if not public.voice_object_within_limits('community-media', new.media_path) then raise exception 'voice_file_invalid' using errcode = '22023'; end if;
  end if;
  return new;
end $$;
revoke all on function public.voice_upload_guard() from public, anon, authenticated;
drop trigger if exists chat_messages_voice_upload on public.chat_messages;
create trigger chat_messages_voice_upload before insert on public.chat_messages for each row execute function public.voice_upload_guard();
drop trigger if exists community_posts_voice_upload on public.community_posts;
create trigger community_posts_voice_upload before insert on public.community_posts for each row execute function public.voice_upload_guard();
drop trigger if exists community_comments_voice_upload on public.community_comments;
create trigger community_comments_voice_upload before insert on public.community_comments for each row execute function public.voice_upload_guard();
