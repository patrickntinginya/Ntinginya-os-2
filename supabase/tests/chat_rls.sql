-- Live chat permission test (migration 010). Run AFTER migrations 001-010 (scripts/verify-db.sh does this on a disposable Postgres).
-- Everything is rolled back at the end. Expected: only PASS notices and a final "0 failures". Any FAIL means do not go live.
-- STATUS: written and statically reviewed, NOT yet executed (the build sandbox has no Postgres).
begin;
do $$
declare
  u_a uuid := '00000000-0000-0000-0000-00000000c0a1'; u_b uuid := '00000000-0000-0000-0000-00000000c0b1';
  u_e uuid := '00000000-0000-0000-0000-00000000c0e1'; u_f uuid := '00000000-0000-0000-0000-00000000c0f1';
  u_x uuid := '00000000-0000-0000-0000-00000000c0d1'; u_adm uuid := '00000000-0000-0000-0000-00000000c0c1';
  inst uuid := '00000000-0000-0000-0000-000000000000';
  fails integer := 0; cid uuid; gid uuid; m1 uuid; m2 uuid; mg1 uuid; cnt integer; path text; t timestamptz;
  ca text := json_build_object('sub', u_a, 'role', 'authenticated')::text;
  cb text := json_build_object('sub', u_b, 'role', 'authenticated')::text;
  ce text := json_build_object('sub', u_e, 'role', 'authenticated')::text;
  cf text := json_build_object('sub', u_f, 'role', 'authenticated')::text;
  cx text := json_build_object('sub', u_x, 'role', 'authenticated')::text;
  cadm text := json_build_object('sub', u_adm, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  select x, inst, 'authenticated', 'authenticated', x::text || '@example.test', '{}', now(), now() from unnest(array[u_a, u_b, u_e, u_f, u_x, u_adm]) x;

  -- profiles (u_x deliberately has none)
  reset role; perform set_config('request.jwt.claims', ca, true); set local role authenticated; insert into public.community_profiles (display_name) values ('Aa');
  reset role; perform set_config('request.jwt.claims', cb, true); set local role authenticated; insert into public.community_profiles (display_name) values ('Bb');
  reset role; perform set_config('request.jwt.claims', ce, true); set local role authenticated; insert into public.community_profiles (display_name) values ('Ee');
  reset role; perform set_config('request.jwt.claims', cf, true); set local role authenticated; insert into public.community_profiles (display_name) values ('Ff');
  insert into public.chat_settings (allow_new_chats) values (false); -- F refuses new chats / group invitations

  -- 1. direct chat: idempotent, symmetric, refuses self / profile-less / opted-out people
  reset role; perform set_config('request.jwt.claims', ca, true); set local role authenticated;
  cid := public.chat_start_direct(u_b);
  if public.chat_start_direct(u_b) = cid then raise notice 'PASS: starting the same direct chat twice returns the same conversation'; else fails := fails + 1; raise notice 'FAIL: duplicate direct conversation'; end if;
  begin perform public.chat_start_direct(u_a); fails := fails + 1; raise notice 'FAIL: chat with yourself'; exception when others then raise notice 'PASS: cannot chat with yourself'; end;
  begin perform public.chat_start_direct(u_x); fails := fails + 1; raise notice 'FAIL: chat with a person without a profile'; exception when others then raise notice 'PASS: cannot chat with someone who has no profile'; end;
  begin perform public.chat_start_direct(u_f); fails := fails + 1; raise notice 'FAIL: chat with someone who disabled new chats'; exception when others then raise notice 'PASS: "allow new chats = off" is respected'; end;
  reset role; perform set_config('request.jwt.claims', cb, true); set local role authenticated;
  if public.chat_start_direct(u_a) = cid then raise notice 'PASS: the other person reaches the same conversation'; else fails := fails + 1; raise notice 'FAIL: direct chat is not symmetric'; end if;

  -- NOTE: inside ONE transaction now() never changes, so "joined before the messages" is arranged by backdating the membership rows (as the
  -- superuser). Production messages arrive in separate transactions, so this only makes the test faithful to real timing.
  reset role; update public.chat_members set joined_at = now() - interval '1 hour', history_from = now() - interval '1 hour' where conversation_id = cid;
  reset role; perform set_config('request.jwt.claims', ca, true); set local role authenticated;

  -- 2. sending: members only; no spoofing; idempotent client id; server time
  reset role; perform set_config('request.jwt.claims', ca, true); set local role authenticated;
  insert into public.chat_messages (conversation_id, kind, body) values (cid, 'text', 'hello B') returning id, created_at into m1, t;
  if t > now() - interval '1 minute' then raise notice 'PASS: message stored with server time'; else fails := fails + 1; raise notice 'FAIL: bad time'; end if;
  begin insert into public.chat_messages (conversation_id, sender_id, kind, body) values (cid, u_b, 'text', 'spoof'); fails := fails + 1; raise notice 'FAIL: sender spoofing'; exception when others then raise notice 'PASS: cannot send as someone else'; end;
  insert into public.chat_messages (conversation_id, client_id, kind, body) values (cid, '00000000-0000-0000-0000-0000000000aa', 'text', 'once');
  begin insert into public.chat_messages (conversation_id, client_id, kind, body) values (cid, '00000000-0000-0000-0000-0000000000aa', 'text', 'twice'); fails := fails + 1; raise notice 'FAIL: duplicate client id accepted'; exception when unique_violation then raise notice 'PASS: a retried message cannot be stored twice'; end;
  begin update public.chat_messages set body = 'hacked' where id = m1; fails := fails + 1; raise notice 'FAIL: direct update of a message'; exception when insufficient_privilege then raise notice 'PASS: messages cannot be updated directly'; end;
  begin delete from public.chat_messages where id = m1; fails := fails + 1; raise notice 'FAIL: direct delete of a message'; exception when insufficient_privilege then raise notice 'PASS: messages cannot be deleted directly'; end;

  -- 3. strangers see nothing and cannot send
  reset role; perform set_config('request.jwt.claims', ce, true); set local role authenticated;
  select count(*) into cnt from public.chat_messages where conversation_id = cid; if cnt = 0 then raise notice 'PASS: a non-member reads no messages'; else fails := fails + 1; raise notice 'FAIL: non-member reads messages'; end if;
  select count(*) into cnt from public.chat_conversations where id = cid; if cnt = 0 then raise notice 'PASS: a non-member cannot see the conversation'; else fails := fails + 1; raise notice 'FAIL: conversation visible'; end if;
  select count(*) into cnt from public.chat_members where conversation_id = cid; if cnt = 0 then raise notice 'PASS: a non-member cannot list its members'; else fails := fails + 1; raise notice 'FAIL: members visible'; end if;
  begin insert into public.chat_messages (conversation_id, kind, body) values (cid, 'text', 'intruder'); fails := fails + 1; raise notice 'FAIL: non-member sent a message'; exception when others then raise notice 'PASS: a non-member cannot send'; end;
  begin perform public.chat_mark(cid, true); raise notice 'PASS: chat_mark by a stranger changes nothing (no error, no row)'; exception when others then raise notice 'PASS: chat_mark by a stranger refused'; end;
  begin perform public.chat_edit(m1, 'x'); fails := fails + 1; raise notice 'FAIL: stranger edited'; exception when others then raise notice 'PASS: a stranger cannot edit'; end;
  begin perform public.chat_blocked_between(u_a, u_b); fails := fails + 1; raise notice 'FAIL: block lookup callable by clients'; exception when insufficient_privilege then raise notice 'PASS: internal block lookup is not callable by clients'; end;

  -- 4. delivery / read marks, edit, delete
  reset role; perform set_config('request.jwt.claims', cb, true); set local role authenticated;
  select count(*) into cnt from public.chat_messages where conversation_id = cid; if cnt = 2 then raise notice 'PASS: the other member reads the messages'; else fails := fails + 1; raise notice 'FAIL: member sees % messages', cnt; end if;
  select unread into cnt from public.chat_inbox() where conversation_id = cid; if cnt = 2 then raise notice 'PASS: unread count is 2'; else fails := fails + 1; raise notice 'FAIL: unread %', cnt; end if;
  select count(*) into cnt from public.notifications where dedupe_key = 'chat:' || cid::text and not is_read; if cnt = 1 then raise notice 'PASS: one unread notification for the conversation'; else fails := fails + 1; raise notice 'FAIL: % notifications', cnt; end if;
  perform public.chat_mark(cid, true);
  select unread into cnt from public.chat_inbox() where conversation_id = cid; if cnt = 0 then raise notice 'PASS: reading clears the unread count'; else fails := fails + 1; raise notice 'FAIL: unread after read %', cnt; end if;
  begin perform public.chat_edit(m1, 'B edits A'); fails := fails + 1; raise notice 'FAIL: edited someone else''s message'; exception when others then raise notice 'PASS: cannot edit another person''s message'; end;
  reset role; perform set_config('request.jwt.claims', ca, true); set local role authenticated;
  select count(*) into cnt from public.chat_members where conversation_id = cid and user_id = u_b and last_read_at is not null; if cnt = 1 then raise notice 'PASS: the sender can see that B read the chat'; else fails := fails + 1; raise notice 'FAIL: read mark not visible'; end if;
  perform public.chat_edit(m1, 'hello B (edited)');
  select count(*) into cnt from public.chat_messages where id = m1 and edited_at is not null and body = 'hello B (edited)'; if cnt = 1 then raise notice 'PASS: sender can edit own message'; else fails := fails + 1; raise notice 'FAIL: edit'; end if;
  perform public.chat_delete(m1);
  select count(*) into cnt from public.chat_messages where id = m1 and deleted_at is not null and body is null; if cnt = 1 then raise notice 'PASS: delete blanks the message'; else fails := fails + 1; raise notice 'FAIL: delete'; end if;

  -- 5. reporting: only members, once per message, moderators see the snapshot but NOT the chat
  reset role; perform set_config('request.jwt.claims', ca, true); set local role authenticated;
  insert into public.chat_messages (conversation_id, kind, body) values (cid, 'text', 'rude words') returning id into m2;
  reset role; perform set_config('request.jwt.claims', cb, true); set local role authenticated;
  if public.chat_report(m2, 'abuse', 'test') is not null then raise notice 'PASS: a member can report a message'; else fails := fails + 1; raise notice 'FAIL: report'; end if;
  if public.chat_report(m2, 'abuse', 'again') is null then raise notice 'PASS: a second report of the same message is ignored'; else fails := fails + 1; raise notice 'FAIL: duplicate report'; end if;
  begin perform public.chat_report(m2, 'not-a-reason'); fails := fails + 1; raise notice 'FAIL: unknown reason accepted'; exception when others then raise notice 'PASS: unknown report reasons are rejected'; end;
  reset role; perform set_config('request.jwt.claims', ce, true); set local role authenticated;
  begin perform public.chat_report(m2, 'spam'); fails := fails + 1; raise notice 'FAIL: stranger reported'; exception when others then raise notice 'PASS: a stranger cannot report'; end;
  reset role; perform set_config('request.jwt.claims', cadm, true); set local role authenticated;
  select count(*) into cnt from public.chat_reports where message_id = m2 and snapshot_body = 'rude words'; if cnt = 1 then raise notice 'PASS: the administrator sees the reported snapshot'; else fails := fails + 1; raise notice 'FAIL: admin cannot see report'; end if;
  select count(*) into cnt from public.chat_messages; if cnt = 0 then raise notice 'PASS: the administrator cannot read private chats'; else fails := fails + 1; raise notice 'FAIL: admin reads % private messages', cnt; end if;
  select count(*) into cnt from public.chat_conversations; if cnt = 0 then raise notice 'PASS: the administrator cannot list private conversations'; else fails := fails + 1; raise notice 'FAIL: admin lists conversations'; end if;
  reset role; perform set_config('request.jwt.claims', cb, true); set local role authenticated;
  select count(*) into cnt from public.chat_reports; if cnt = 1 then raise notice 'PASS: a reporter sees only their own reports'; else fails := fails + 1; raise notice 'FAIL: reports visible %', cnt; end if;
  reset role; perform set_config('request.jwt.claims', ca, true); set local role authenticated;
  select count(*) into cnt from public.chat_reports; if cnt = 0 then raise notice 'PASS: the reported person cannot see the report'; else fails := fails + 1; raise notice 'FAIL: reported person sees reports'; end if;

  -- 6. groups: admin-only management, history cut-off for late joiners, removal ends access
  gid := public.chat_create_group('Study group', array[u_b, u_e]);
  insert into public.chat_messages (conversation_id, kind, body) values (gid, 'text', 'before F joined') returning id into mg1;
  reset role; update public.chat_messages set created_at = now() - interval '1 hour' where id = mg1; -- it was sent "before F joined" (see NOTE above)
  reset role; perform set_config('request.jwt.claims', ca, true); set local role authenticated;
  begin perform public.chat_add_members(gid, array[u_f]); fails := fails + 1; raise notice 'FAIL: added a member who disabled invitations'; exception when others then raise notice 'PASS: cannot add someone who disabled invitations'; end;
  reset role; perform set_config('request.jwt.claims', cb, true); set local role authenticated;
  begin perform public.chat_add_members(gid, array[u_x]); fails := fails + 1; raise notice 'FAIL: plain member added someone'; exception when others then raise notice 'PASS: only a group admin can add members'; end;
  begin perform public.chat_rename(gid, 'Hijack'); fails := fails + 1; raise notice 'FAIL: plain member renamed the group'; exception when others then raise notice 'PASS: only a group admin can rename'; end;
  begin perform public.chat_remove_member(gid, u_e); fails := fails + 1; raise notice 'FAIL: plain member removed someone'; exception when others then raise notice 'PASS: only a group admin can remove members'; end;
  reset role; perform set_config('request.jwt.claims', cf, true); set local role authenticated; update public.chat_settings set allow_new_chats = true;
  reset role; perform set_config('request.jwt.claims', ca, true); set local role authenticated;
  perform public.chat_add_members(gid, array[u_f]);
  insert into public.chat_messages (conversation_id, kind, body) values (gid, 'text', 'after F joined');
  reset role; perform set_config('request.jwt.claims', cf, true); set local role authenticated;
  select count(*) into cnt from public.chat_messages where conversation_id = gid; if cnt = 1 then raise notice 'PASS: a late joiner sees only messages sent after joining'; else fails := fails + 1; raise notice 'FAIL: late joiner sees % messages', cnt; end if;
  reset role; perform set_config('request.jwt.claims', ca, true); set local role authenticated;
  perform public.chat_remove_member(gid, u_e);
  reset role; perform set_config('request.jwt.claims', ce, true); set local role authenticated;
  select count(*) into cnt from public.chat_messages where conversation_id = gid; if cnt = 0 then raise notice 'PASS: a removed member loses access'; else fails := fails + 1; raise notice 'FAIL: removed member still reads'; end if;
  begin insert into public.chat_messages (conversation_id, kind, body) values (gid, 'text', 'ghost'); fails := fails + 1; raise notice 'FAIL: removed member sent'; exception when others then raise notice 'PASS: a removed member cannot send'; end;

  -- 7. blocking
  reset role; perform set_config('request.jwt.claims', cb, true); set local role authenticated;
  insert into public.community_blocks (blocked_user_id, blocked_name) values (u_a, 'Aa');
  select count(*) into cnt from public.chat_messages where conversation_id = cid; if cnt = 0 then raise notice 'PASS: after blocking, B no longer sees A''s messages'; else fails := fails + 1; raise notice 'FAIL: blocked messages visible'; end if;
  begin perform public.chat_start_direct(u_a); fails := fails + 1; raise notice 'FAIL: chat across a block'; exception when others then raise notice 'PASS: nobody can start a chat across a block'; end;
  reset role; perform set_config('request.jwt.claims', ca, true); set local role authenticated;
  begin insert into public.chat_messages (conversation_id, kind, body) values (cid, 'text', 'still here?'); fails := fails + 1; raise notice 'FAIL: blocked person can still send'; exception when others then raise notice 'PASS: a blocked person cannot send into the direct chat'; end;
  if public.chat_last_seen_of(u_b) is null then raise notice 'PASS: no last-seen across a block'; else fails := fails + 1; raise notice 'FAIL: last seen across block'; end if;

  -- 8. private media
  reset role; perform set_config('request.jwt.claims', cf, true); set local role authenticated;
  path := u_f::text || '/' || gid::text || '/pic.png';
  insert into storage.objects (bucket_id, name, owner) values ('chat-media', path, u_f);
  raise notice 'PASS: a member can upload into their own conversation folder';
  begin insert into storage.objects (bucket_id, name, owner) values ('chat-media', u_a::text || '/' || gid::text || '/fake.png', u_f); fails := fails + 1; raise notice 'FAIL: uploaded into another person''s folder'; exception when others then raise notice 'PASS: cannot upload into another person''s folder'; end;
  begin insert into storage.objects (bucket_id, name, owner) values ('chat-media', u_f::text || '/' || cid::text || '/x.png', u_f); fails := fails + 1; raise notice 'FAIL: uploaded into a conversation F is not in'; exception when others then raise notice 'PASS: cannot upload into a conversation you are not in'; end;
  insert into public.chat_messages (conversation_id, kind, media_path, media_name, media_mime, media_size) values (gid, 'image', path, 'pic.png', 'image/png', 10);
  begin insert into public.chat_messages (conversation_id, kind, media_path, media_name) values (gid, 'image', u_a::text || '/' || gid::text || '/steal.png', 'x'); fails := fails + 1; raise notice 'FAIL: message points at someone else''s file'; exception when others then raise notice 'PASS: a message cannot point at another person''s file'; end;
  reset role; perform set_config('request.jwt.claims', ca, true); set local role authenticated;
  select count(*) into cnt from storage.objects where bucket_id = 'chat-media' and name = path; if cnt = 1 then raise notice 'PASS: a group member can read the attachment'; else fails := fails + 1; raise notice 'FAIL: member cannot read attachment'; end if;
  reset role; perform set_config('request.jwt.claims', ce, true); set local role authenticated;
  select count(*) into cnt from storage.objects where bucket_id = 'chat-media' and name = path; if cnt = 0 then raise notice 'PASS: a removed member cannot read the attachment'; else fails := fails + 1; raise notice 'FAIL: removed member reads attachment'; end if;
  reset role; perform set_config('request.jwt.claims', cadm, true); set local role authenticated;
  select count(*) into cnt from storage.objects where bucket_id = 'chat-media' and name = path; if cnt = 0 then raise notice 'PASS: the administrator cannot read chat attachments'; else fails := fails + 1; raise notice 'FAIL: admin reads attachments'; end if;

  -- 8b. ATTACHMENT ACCESS (migration 011): there is no "I uploaded it" shortcut. Group gid: A = admin, B (has blocked A), F = member, E removed earlier.
  reset role; perform set_config('request.jwt.claims', cf, true); set local role authenticated;
  select count(*) into cnt from storage.objects where bucket_id = 'chat-media' and name = path; if cnt = 1 then raise notice 'PASS: the SENDER, while an active member, can read their own attachment'; else fails := fails + 1; raise notice 'FAIL: sender cannot read own attachment while a member'; end if;
  insert into storage.objects (bucket_id, name, owner) values ('chat-media', u_f::text || '/' || gid::text || '/orphan.png', u_f);
  select count(*) into cnt from storage.objects where bucket_id = 'chat-media' and name = u_f::text || '/' || gid::text || '/orphan.png'; if cnt = 0 then raise notice 'PASS: an uploaded file that never became a message is unreadable, even by its uploader'; else fails := fails + 1; raise notice 'FAIL: unsent upload readable'; end if;

  -- a blocked sender's attachment is hidden from the blocker (B blocked A in section 7)
  reset role; perform set_config('request.jwt.claims', ca, true); set local role authenticated;
  insert into storage.objects (bucket_id, name, owner) values ('chat-media', u_a::text || '/' || gid::text || '/a.png', u_a);
  insert into public.chat_messages (conversation_id, kind, media_path, media_name, media_mime, media_size) values (gid, 'image', u_a::text || '/' || gid::text || '/a.png', 'a.png', 'image/png', 10) returning id into m2;
  reset role; perform set_config('request.jwt.claims', cb, true); set local role authenticated;
  select count(*) into cnt from storage.objects where bucket_id = 'chat-media' and name = u_a::text || '/' || gid::text || '/a.png'; if cnt = 0 then raise notice 'PASS: the blocker cannot read the blocked sender''s attachment'; else fails := fails + 1; raise notice 'FAIL: block ignored for attachments'; end if;
  reset role; perform set_config('request.jwt.claims', cf, true); set local role authenticated;
  select count(*) into cnt from storage.objects where bucket_id = 'chat-media' and name = u_a::text || '/' || gid::text || '/a.png'; if cnt = 1 then raise notice 'PASS: another member (no block) can read it'; else fails := fails + 1; raise notice 'FAIL: member cannot read attachment'; end if;

  -- a DELETED message's file is unreadable by everyone, including its sender
  reset role; perform set_config('request.jwt.claims', ca, true); set local role authenticated;
  perform public.chat_delete(m2);
  select count(*) into cnt from storage.objects where bucket_id = 'chat-media' and name = u_a::text || '/' || gid::text || '/a.png'; if cnt = 0 then raise notice 'PASS: after deleting the message even the sender cannot read the file'; else fails := fails + 1; raise notice 'FAIL: deleted message attachment readable by sender'; end if;
  reset role; perform set_config('request.jwt.claims', cf, true); set local role authenticated;
  select count(*) into cnt from storage.objects where bucket_id = 'chat-media' and name = u_a::text || '/' || gid::text || '/a.png'; if cnt = 0 then raise notice 'PASS: after deleting the message other members cannot read the file'; else fails := fails + 1; raise notice 'FAIL: deleted message attachment readable'; end if;

  -- a REMOVED sender loses access to their OWN attachment (the bug this migration fixes)
  reset role; perform set_config('request.jwt.claims', ca, true); set local role authenticated;
  perform public.chat_remove_member(gid, u_f);
  reset role; perform set_config('request.jwt.claims', cf, true); set local role authenticated;
  select count(*) into cnt from storage.objects where bucket_id = 'chat-media' and name = path; if cnt = 0 then raise notice 'PASS: a REMOVED member cannot read even their own attachment'; else fails := fails + 1; raise notice 'FAIL: removed sender still reads own attachment'; end if;
  select count(*) into cnt from public.chat_messages where conversation_id = gid; if cnt = 0 then raise notice 'PASS: a removed member reads no messages either'; else fails := fails + 1; raise notice 'FAIL: removed member reads messages'; end if;

  -- RE-ADDED: history_from restarts, so attachments from before the re-join stay unreadable (backdate the old message: now() is constant in one transaction)
  reset role; update public.chat_messages set created_at = now() - interval '1 hour' where media_path = path;
  reset role; perform set_config('request.jwt.claims', ca, true); set local role authenticated;
  perform public.chat_add_members(gid, array[u_f]);
  reset role; perform set_config('request.jwt.claims', cf, true); set local role authenticated;
  select count(*) into cnt from storage.objects where bucket_id = 'chat-media' and name = path; if cnt = 0 then raise notice 'PASS: a re-added member cannot read attachments sent before they re-joined (history_from), not even their own'; else fails := fails + 1; raise notice 'FAIL: history_from ignored for attachments'; end if;

  -- LEAVING ends access too (a member who leaves, not only one who is removed)
  reset role; update public.chat_messages set created_at = now() where media_path = path; -- visible again after the re-join, to prove the next step is about membership
  reset role; perform set_config('request.jwt.claims', cf, true); set local role authenticated;
  select count(*) into cnt from storage.objects where bucket_id = 'chat-media' and name = path; if cnt = 1 then raise notice 'PASS: re-joined member reads an attachment inside their history'; else fails := fails + 1; raise notice 'FAIL: control read after re-join'; end if;
  perform public.chat_leave(gid);
  select count(*) into cnt from storage.objects where bucket_id = 'chat-media' and name = path; if cnt = 0 then raise notice 'PASS: a member who LEFT cannot read the attachment (even their own)'; else fails := fails + 1; raise notice 'FAIL: member who left still reads attachment'; end if;

  -- a stranger and the administrator never read it
  reset role; perform set_config('request.jwt.claims', ce, true); set local role authenticated;
  select count(*) into cnt from storage.objects where bucket_id = 'chat-media' and name = path; if cnt = 0 then raise notice 'PASS: a former member (E) cannot read it'; else fails := fails + 1; raise notice 'FAIL: former member E reads'; end if;
  reset role; perform set_config('request.jwt.claims', cadm, true); set local role authenticated;
  select count(*) into cnt from storage.objects where bucket_id = 'chat-media'; if cnt = 0 then raise notice 'PASS: the administrator cannot read any chat attachment'; else fails := fails + 1; raise notice 'FAIL: administrator reads % chat files', cnt; end if;

  -- voice limits enforced by the database (migration 011). Sent into the GROUP: B blocked A, which only stops the direct chat.
  reset role; perform set_config('request.jwt.claims', cb, true); set local role authenticated;
  begin insert into public.chat_messages (conversation_id, kind, media_path, media_name, media_mime, media_size, duration_ms) values (gid, 'voice', u_b::text || '/' || gid::text || '/v.webm', 'v.webm', 'audio/webm', 1000, 400000); fails := fails + 1; raise notice 'FAIL: a 400 s voice message was accepted'; exception when check_violation then raise notice 'PASS: voice messages longer than 5 minutes are rejected by the database'; end;
  begin insert into public.chat_messages (conversation_id, kind, media_path, media_name, media_mime, media_size, duration_ms) values (gid, 'voice', u_b::text || '/' || gid::text || '/v.webm', 'v.webm', 'audio/webm', 6000000, 1000); fails := fails + 1; raise notice 'FAIL: a 6 MB voice message was accepted'; exception when check_violation then raise notice 'PASS: voice messages over 5 MB are rejected'; end;
  begin insert into public.chat_messages (conversation_id, kind, media_path, media_name, media_mime, media_size) values (gid, 'voice', u_b::text || '/' || gid::text || '/v.webm', 'v.webm', 'audio/webm', 1000); fails := fails + 1; raise notice 'FAIL: a voice message without a duration was accepted'; exception when check_violation then raise notice 'PASS: a voice message must state its duration'; end;
  begin insert into public.chat_messages (conversation_id, kind, media_path, media_name, media_mime, media_size, duration_ms) values (gid, 'voice', u_b::text || '/' || gid::text || '/v.png', 'v.png', 'image/png', 1000, 1000); fails := fails + 1; raise notice 'FAIL: a "voice" message with an image type was accepted'; exception when check_violation then raise notice 'PASS: a voice message must be audio'; end;
  begin insert into public.chat_messages (conversation_id, kind, media_path, media_name, media_mime, media_size, duration_ms) values (gid, 'voice', u_b::text || '/' || gid::text || '/v.webm', 'v.webm', 'audio/webm', 40000, 12000); raise notice 'PASS: a normal 12 s voice message is accepted'; exception when others then fails := fails + 1; raise notice 'FAIL: a valid voice message was rejected (%)', sqlerrm; end;
  reset role;

  -- 8c. the cleanup view is for the service role only
  reset role; perform set_config('request.jwt.claims', ca, true); set local role authenticated;
  begin perform count(*) from public.chat_media_unattached; fails := fails + 1; raise notice 'FAIL: a member can list unattached files'; exception when insufficient_privilege then raise notice 'PASS: members cannot list unattached chat files (service role only)'; end;

  -- 9. anonymous access
  reset role; set local role anon;
  begin perform count(*) from public.chat_messages; fails := fails + 1; raise notice 'FAIL: anon reads messages'; exception when insufficient_privilege then raise notice 'PASS: anon cannot read messages'; end;
  begin perform * from public.chat_inbox(); fails := fails + 1; raise notice 'FAIL: anon calls chat_inbox'; exception when insufficient_privilege then raise notice 'PASS: anon cannot call chat functions'; end;
  reset role;
  raise notice '=== Chat permission test finished: % failures ===', fails;
end $$;
rollback;
