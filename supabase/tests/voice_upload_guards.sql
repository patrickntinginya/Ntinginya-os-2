-- Voice upload trigger regression coverage for migration 015. Run only on a disposable local database.
begin;

create function pg_temp.try_voice_upload(
  p_table text, p_row_user uuid, p_path text, p_mime text, p_size bigint,
  p_duration integer, p_conversation uuid, p_post uuid
) returns boolean language plpgsql as $$
begin
  if p_table = 'chat_messages' then
    execute 'insert into public.chat_messages (conversation_id, sender_id, kind, media_path, media_name, media_mime, media_size, duration_ms)
      values ($1, $2, ''voice'', $3, ''voice.webm'', $4, $5, $6)'
      using p_conversation, p_row_user, p_path, p_mime, p_size, p_duration;
  elsif p_table = 'community_posts' then
    execute 'insert into public.community_posts (user_id, body, media_kind, media_path, media_mime, media_size, duration_ms)
      values ($1, '''', ''voice'', $2, $3, $4, $5)'
      using p_row_user, p_path, p_mime, p_size, p_duration;
  elsif p_table = 'community_comments' then
    execute 'insert into public.community_comments (user_id, post_id, body, media_kind, media_path, media_mime, media_size, duration_ms)
      values ($1, $2, '''', ''voice'', $3, $4, $5, $6)'
      using p_row_user, p_post, p_path, p_mime, p_size, p_duration;
  else
    raise exception 'unsupported test table: %', p_table;
  end if;
  return true;
exception
  when check_violation or insufficient_privilege or sqlstate '22023' then return false;
end $$;

do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000000f1';
  other_user uuid := '00000000-0000-0000-0000-0000000000f2';
  inst uuid := '00000000-0000-0000-0000-000000000000';
  conversation uuid := '00000000-0000-0000-0000-0000000000f3';
  post uuid;
  fails integer := 0;
  claims text := json_build_object('sub', u, 'role', 'authenticated')::text;
  chat_prefix text := u::text || '/' || conversation::text || '/';
  community_prefix text := u::text || '/';
  wrong_prefix text := other_user::text || '/';
  table_name text;
  valid_path text;
  missing_path text;
  wrong_owner_path text;
  wrong_path text;
  large_path text;
  non_audio_path text;
  result boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
    (u, inst, 'authenticated', 'authenticated', 'voice-guard@example.test', '{}', now(), now()),
    (other_user, inst, 'authenticated', 'authenticated', 'voice-guard-other@example.test', '{}', now(), now());
  insert into public.community_profiles (user_id, display_name) values (u, 'Voice guard'), (other_user, 'Voice guard other');
  insert into public.community_posts (user_id, body) values (u, 'Voice guard comment target') returning id into post;
  insert into public.chat_conversations (id, kind, direct_key, created_by)
    values (conversation, 'direct', 'voice-guard:' || u::text, u);
  insert into public.chat_members (conversation_id, user_id) values (conversation, u);

  foreach table_name in array array['chat_messages', 'community_posts', 'community_comments'] loop
    if table_name = 'chat_messages' then
      valid_path := chat_prefix || 'valid.webm';
      missing_path := chat_prefix || 'missing.webm';
      wrong_owner_path := wrong_prefix || conversation::text || '/owned-by-other.webm';
      wrong_path := wrong_prefix || conversation::text || '/wrong-folder.webm';
      large_path := chat_prefix || 'oversized.webm';
      non_audio_path := chat_prefix || 'not-audio.webm';
    else
      valid_path := community_prefix || table_name || '-valid.webm';
      missing_path := community_prefix || table_name || '-missing.webm';
      wrong_owner_path := wrong_prefix || table_name || '-owned-by-other.webm';
      wrong_path := wrong_prefix || table_name || '-wrong-folder.webm';
      large_path := community_prefix || table_name || '-oversized.webm';
      non_audio_path := community_prefix || table_name || '-not-audio.webm';
    end if;

    insert into storage.objects (bucket_id, name, owner, metadata) values
      (case when table_name = 'chat_messages' then 'chat-media' else 'community-media' end, valid_path, u, '{"size":4096,"mimetype":"audio/webm"}'),
      (case when table_name = 'chat_messages' then 'chat-media' else 'community-media' end, wrong_owner_path, other_user, '{"size":4096,"mimetype":"audio/webm"}'),
      (case when table_name = 'chat_messages' then 'chat-media' else 'community-media' end, wrong_path, other_user, '{"size":4096,"mimetype":"audio/webm"}'),
      (case when table_name = 'chat_messages' then 'chat-media' else 'community-media' end, large_path, u, '{"size":5242881,"mimetype":"audio/webm"}'),
      (case when table_name = 'chat_messages' then 'chat-media' else 'community-media' end, non_audio_path, u, '{"size":4096,"mimetype":"image/png"}');

    perform set_config('request.jwt.claims', claims, true);
    set local role authenticated;
    result := pg_temp.try_voice_upload(table_name, u, valid_path, 'audio/webm', 4096, 1000, conversation, post);
    reset role;
    if result then raise notice 'PASS: valid voice upload accepted on %', table_name;
    else fails := fails + 1; raise notice 'FAIL: valid voice upload rejected on %', table_name; end if;

    perform set_config('request.jwt.claims', claims, true);
    set local role authenticated;
    result := pg_temp.try_voice_upload(table_name, u, missing_path, 'audio/webm', 4096, 1000, conversation, post);
    reset role;
    if not result then raise notice 'PASS: missing Storage object rejected on %', table_name;
    else fails := fails + 1; raise notice 'FAIL: missing Storage object accepted on %', table_name; end if;

    perform set_config('request.jwt.claims', claims, true);
    set local role authenticated;
    result := pg_temp.try_voice_upload(table_name, other_user, wrong_owner_path, 'audio/webm', 4096, 1000, conversation, post);
    reset role;
    if not result then raise notice 'PASS: mismatched row owner rejected on %', table_name;
    else fails := fails + 1; raise notice 'FAIL: mismatched row owner accepted on %', table_name; end if;

    perform set_config('request.jwt.claims', claims, true);
    set local role authenticated;
    result := pg_temp.try_voice_upload(table_name, u, wrong_path, 'audio/webm', 4096, 1000, conversation, post);
    reset role;
    if not result then raise notice 'PASS: wrong-owner path rejected on %', table_name;
    else fails := fails + 1; raise notice 'FAIL: wrong-owner path accepted on %', table_name; end if;

    perform set_config('request.jwt.claims', claims, true);
    set local role authenticated;
    result := pg_temp.try_voice_upload(table_name, u, large_path, 'audio/webm', 4096, 1000, conversation, post);
    reset role;
    if not result then raise notice 'PASS: actual object over 5 MiB rejected on %', table_name;
    else fails := fails + 1; raise notice 'FAIL: actual object over 5 MiB accepted on %', table_name; end if;

    perform set_config('request.jwt.claims', claims, true);
    set local role authenticated;
    result := pg_temp.try_voice_upload(table_name, u, non_audio_path, 'audio/webm', 4096, 1000, conversation, post);
    reset role;
    if not result then raise notice 'PASS: non-audio Storage metadata rejected on %', table_name;
    else fails := fails + 1; raise notice 'FAIL: non-audio Storage metadata accepted on %', table_name; end if;
  end loop;

  if fails > 0 then raise exception 'voice_upload_guards had % failure(s)', fails; end if;
  raise notice 'voice_upload_guards: 0 failures';
end $$;
rollback;
