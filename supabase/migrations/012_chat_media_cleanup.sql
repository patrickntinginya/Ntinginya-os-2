-- V6: housekeeping for chat attachments. Run after 011. Additive.
-- Since 011 a chat file is readable only while a live message points at it. Two situations therefore leave a file that NOBODY can read and that the
-- app can no longer delete through the Storage API: a send that failed after the upload, and a message deleted by a member who had already left.
-- This view lists such files so a trusted job (service role key, never the app) can delete them: scripts/cleanup-chat-media.mjs.
-- The one-hour margin keeps it away from an upload whose message is still being inserted.
create or replace view public.chat_media_unattached as
  select o.name, o.created_at
  from storage.objects o
  where o.bucket_id = 'chat-media'
    and o.created_at < now() - interval '1 hour'
    and not exists (select 1 from public.chat_messages m where m.media_path = o.name);
revoke all on public.chat_media_unattached from public, anon, authenticated;
grant select on public.chat_media_unattached to service_role;
