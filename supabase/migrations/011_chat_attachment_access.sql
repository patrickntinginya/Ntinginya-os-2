-- V6: (1) SECURITY FIX for chat attachment reads, (2) server-side limits for voice messages. Run after 010. Additive: replaces one function, adds one constraint.
--
-- (1) The 010 version of chat_storage_can_read() let the ORIGINAL SENDER read anything under their own folder (<sender>/...) no matter what:
--     after leaving or being removed from the conversation, after deleting the message, and even for files that never became a message.
--     That contradicted the documented rule "leaving a conversation ends access to its attachments".
--     There is now NO ownership shortcut. An attachment is readable only when ALL of these hold for the caller:
--       a. the object name has the exact <sender uuid>/<conversation uuid>/<file> shape (so the uuid casts never run on junk);
--       b. a chat message points at exactly this object, and that message is in that conversation and was sent by that folder's owner;
--       c. the message is not deleted (deleting a message blanks media_path, so the file is no longer referenced);
--       d. the caller is an ACTIVE member of that conversation right now (left_at is null);
--       e. the message is not older than the caller's history_from (people added later never see earlier attachments, nor does someone who left and was re-added);
--       f. the caller has not blocked the sender (the same rule that hides the message itself).
--     Uploaded-but-never-sent files are therefore unreadable by everyone, including the uploader (the app does not need to read them: it previews the local file).
create or replace function public.chat_storage_can_read(object_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
    then exists (
      select 1
      from public.chat_messages m
      join public.chat_members mem
        on mem.conversation_id = m.conversation_id and mem.user_id = (select auth.uid()) and mem.left_at is null
      where m.media_path = object_name
        and m.deleted_at is null
        and m.sender_id::text = split_part(object_name, '/', 1)
        and m.conversation_id::text = split_part(object_name, '/', 2)
        and m.created_at >= mem.history_from
        and not exists (select 1 from public.community_blocks b where b.user_id = (select auth.uid()) and b.blocked_user_id = m.sender_id)
    )
    else false end
$$;
-- (CREATE OR REPLACE keeps the grants made in 010: execute for signed-in users only.)

-- (2) Voice messages: limits that a modified client cannot skip. 5 minutes, 5 MB, an audio MIME type, and the duration must be stated.
-- NOT VALID: applies to every new or changed row without re-checking old rows (there were no voice messages before this migration).
alter table public.chat_messages drop constraint if exists chat_messages_voice_limits;
alter table public.chat_messages add constraint chat_messages_voice_limits check (
  kind <> 'voice'
  or deleted_at is not null
  or (duration_ms is not null and duration_ms between 500 and 300000
      and media_size is not null and media_size <= 5242880
      and media_mime is not null and media_mime like 'audio/%')
) not valid;
