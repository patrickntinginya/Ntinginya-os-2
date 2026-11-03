-- Slice 1 permission test: Smart Action Center (006, 009) + Community (007, 008, 009, 014, 015).
-- Run in a DISPOSABLE Supabase project or local Postgres (never production) AFTER migrations 001-015. Nothing is kept: the whole script ends with ROLLBACK.
-- Expected: every notice says PASS and the last notice says "0 failures". Any FAIL (or an error) means do not go live.
--
-- Also run by scripts/verify-db.sh against a fresh disposable local PostgreSQL database.
begin;

do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000a1';  -- ordinary member
  b uuid := '00000000-0000-0000-0000-0000000000b1';  -- another ordinary member
  c uuid := '00000000-0000-0000-0000-0000000000c1';  -- administrator (app_metadata.role = admin)
  inst uuid := '00000000-0000-0000-0000-000000000000';
  failures integer := 0;
  n_b uuid; n_a uuid; n_a2 uuid; post_b uuid; post_a uuid; post_g uuid; post_h uuid; post_closed uuid; group_b uuid; report_a uuid;
  comment_a uuid; comment_post uuid; rejected boolean;
  r jsonb; cnt integer; st text; c1 uuid; c2 uuid; ok boolean;
  pub text := b::text || '/pub.jpg'; priv text := b::text || '/priv.jpg'; hid text := b::text || '/hidden.jpg'; av text := b::text || '/avatar.jpg'; mine text := a::text || '/mine.jpg';

  claims_a text := json_build_object('sub', a, 'role', 'authenticated')::text;
  claims_b text := json_build_object('sub', b, 'role', 'authenticated')::text;
  claims_c text := json_build_object('sub', c, 'role', 'authenticated', 'app_metadata', json_build_object('role', 'admin'))::text;
  -- user_metadata is editable by the user, so it must NEVER grant admin.
  claims_fake text := json_build_object('sub', a, 'role', 'authenticated', 'user_metadata', json_build_object('role', 'admin'))::text;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
    (a, inst, 'authenticated', 'authenticated', 'slice1-a@example.test', '{}', now(), now()),
    (b, inst, 'authenticated', 'authenticated', 'slice1-b@example.test', '{}', now(), now()),
    (c, inst, 'authenticated', 'authenticated', 'slice1-c@example.test', '{}', now(), now());

  -- ================= B creates data =================
  perform set_config('request.jwt.claims', claims_b, true);
  set local role authenticated;
  insert into public.notifications (type, title, dedupe_key, action_kind, action_ref)
    values ('reminder', 'B reminder', 'slice1:b:1', 'open', '{}'::jsonb) returning id into n_b;
  insert into public.community_profiles (display_name) values ('Member B');
  insert into public.community_posts (body, media_kind, media_path, media_mime) values ('B public post', 'image', pub, 'image/jpeg') returning id into post_b;
  insert into public.community_groups (name, privacy) values ('B private group', 'private') returning id into group_b;
  insert into public.community_group_members (group_id, role, status) values (group_b, 'owner', 'active');
  insert into public.community_posts (body, group_id, media_kind, media_path, media_mime) values ('B private-group post', group_b, 'image', priv, 'image/jpeg') returning id into post_g;
  insert into public.community_posts (body, media_kind, media_path, media_mime) values ('B post that will be hidden', 'image', hid, 'image/jpeg') returning id into post_h;
  insert into public.community_posts (body) values ('B post with comments closed') returning id into post_closed;
  update public.community_posts set allow_comments = false where id = post_closed;
  update public.community_profiles set avatar_path = av where user_id = b;
  -- Storage objects are created by a privileged role (the bucket and its folders exist after migration 007).
  reset role;
  insert into storage.objects (bucket_id, name, owner) values ('community-media', pub, b), ('community-media', priv, b), ('community-media', hid, b), ('community-media', av, b), ('community-media', mine, a);
  perform set_config('request.jwt.claims', claims_c, true);
  set local role authenticated;
  update public.community_posts set status = 'hidden' where id = post_h;
  reset role;
  perform set_config('request.jwt.claims', claims_b, true);
  set local role authenticated;

  -- ================= A =================
  reset role;
  perform set_config('request.jwt.claims', claims_a, true);
  set local role authenticated;
  insert into public.notifications (type, title, dedupe_key, action_kind, action_ref)
    values ('reminder', 'A reminder', 'slice1:a:1', 'open', '{}'::jsonb) returning id into n_a;
  insert into public.community_profiles (display_name) values ('Member A');

  -- 1. A cannot see B's notification
  select count(*) into cnt from public.notifications where id = n_b;
  if cnt > 0 then failures := failures + 1; raise notice 'FAIL: A can read B''s notification'; else raise notice 'PASS: A cannot read B''s notification'; end if;

  -- 2. A cannot snooze, start or finish DO IT on B's notification
  begin perform public.notification_snooze(n_b, 'slice1-key-a-snooze-b'); failures := failures + 1; raise notice 'FAIL: A snoozed B''s notification';
  exception when others then raise notice 'PASS: A cannot snooze B''s notification'; end;
  begin perform public.notification_begin_action(n_b, 'doit:slice1-b'); failures := failures + 1; raise notice 'FAIL: A started DO IT on B''s notification';
  exception when others then raise notice 'PASS: A cannot start DO IT on B''s notification'; end;
  begin perform public.notification_finish_action(n_b, 'doit:slice1-b', gen_random_uuid(), true, 'x'); failures := failures + 1; raise notice 'FAIL: A finished B''s notification';
  exception when others then raise notice 'PASS: A cannot finish B''s notification'; end;

  -- 3. Snooze: fixed five minutes, server time, a second press does not create or extend a reminder
  r := public.notification_snooze(n_a, 'slice1-key-a-snooze-1');
  if (r->>'snoozed')::boolean and not (r->>'duplicate')::boolean then raise notice 'PASS: first snooze accepted'; else failures := failures + 1; raise notice 'FAIL: first snooze %', r; end if;
  select count(*) into cnt from public.notifications where id = n_a and snoozed_until > now() + interval '4 minutes 30 seconds' and snoozed_until <= now() + interval '5 minutes 5 seconds';
  if cnt = 1 then raise notice 'PASS: snooze is five minutes from the server clock'; else failures := failures + 1; raise notice 'FAIL: snooze time is not ~5 minutes'; end if;
  r := public.notification_snooze(n_a, 'slice1-key-a-snooze-2');
  if (r->>'duplicate')::boolean then raise notice 'PASS: second press returns the same reminder (no duplicate)'; else failures := failures + 1; raise notice 'FAIL: second press %', r; end if;
  select count(*) into cnt from public.notifications where id = n_a and snooze_count = 1;
  if cnt = 1 then raise notice 'PASS: snooze_count stayed at 1'; else failures := failures + 1; raise notice 'FAIL: snooze_count changed'; end if;
  select count(*) into cnt from public.notification_wake_due();
  if cnt = 0 then raise notice 'PASS: nothing wakes before five minutes'; else failures := failures + 1; raise notice 'FAIL: woke early'; end if;
  begin perform public.notification_snooze(n_a, 'slice1-key-a-snooze-b'); perform public.notification_snooze(n_b, 'slice1-key-a-snooze-b');
    failures := failures + 1; raise notice 'FAIL: one key was reused for two notifications';
  exception when others then raise notice 'PASS: an idempotency key cannot be reused for another notification'; end;

  -- 4. Direct writes cannot change what DO IT / snooze depend on
  begin update public.notifications set status = 'done' where id = n_a; failures := failures + 1; raise notice 'FAIL: user set status directly';
  exception when others then raise notice 'PASS: user cannot set status directly'; end;
  begin update public.notifications set snoozed_until = null where id = n_a; failures := failures + 1; raise notice 'FAIL: user cleared a snooze directly';
  exception when others then raise notice 'PASS: user cannot clear/extend a snooze directly'; end;
  begin update public.notifications set action_kind = 'complete_task', action_ref = '{}'::jsonb where id = n_a; failures := failures + 1; raise notice 'FAIL: user rewrote the action';
  exception when others then raise notice 'PASS: user cannot rewrite the action target'; end;
  update public.notifications set is_read = false where id = n_a;
  select count(*) into cnt from public.notifications where id = n_a and is_read = false;
  if cnt = 1 then raise notice 'PASS: user can still mark read/unread'; else failures := failures + 1; raise notice 'FAIL: is_read not editable'; end if;
  begin insert into public.notification_actions (notification_id, action, idempotency_key, outcome) values (n_a, 'do_it', 'forged-audit-key-1', 'succeeded'); failures := failures + 1; raise notice 'FAIL: user forged an audit row';
  exception when others then raise notice 'PASS: user cannot insert audit rows'; end;
  begin update public.notification_actions set outcome = 'succeeded'; failures := failures + 1; raise notice 'FAIL: user edited audit rows';
  exception when others then raise notice 'PASS: user cannot edit audit rows'; end;

  -- 5. DO IT: exactly one live claim; finish needs THAT claim
  reset role; update public.notifications set snoozed_until = null where id = n_a;
  perform set_config('request.jwt.claims', claims_a, true); set local role authenticated;
  r := public.notification_begin_action(n_a, 'doit:slice1-a');
  c1 := (r->>'claim_id')::uuid;
  if (r->>'claimed')::boolean and c1 is not null then raise notice 'PASS: first DO IT claim succeeds and returns a claim id'; else failures := failures + 1; raise notice 'FAIL: first claim %', r; end if;
  r := public.notification_begin_action(n_a, 'doit:slice1-a');
  if not (r->>'claimed')::boolean then raise notice 'PASS: second claim refused while running'; else failures := failures + 1; raise notice 'FAIL: second claim granted'; end if;
  begin perform public.notification_finish_action(n_a, 'doit:slice1-a', gen_random_uuid(), true, 'forged'); failures := failures + 1; raise notice 'FAIL: finished with a forged claim id';
  exception when others then raise notice 'PASS: forged claim id is rejected'; end;
  begin perform public.notification_finish_action(n_a, 'doit:other-key', c1, true, 'wrong key'); failures := failures + 1; raise notice 'FAIL: finished with a key that has no audit record';
  exception when others then raise notice 'PASS: a key without a matching audit record is rejected'; end;
  r := public.notification_finish_action(n_a, 'doit:slice1-a', c1, true, 'done');
  if r->>'status' = 'done' then raise notice 'PASS: DO IT finished with the live claim'; else failures := failures + 1; raise notice 'FAIL: finish %', r; end if;
  r := public.notification_finish_action(n_a, 'doit:slice1-a', c1, true, 'done');
  if (r->>'replay')::boolean then raise notice 'PASS: repeating the same finish is an idempotent replay'; else failures := failures + 1; raise notice 'FAIL: replay %', r; end if;
  r := public.notification_begin_action(n_a, 'doit:slice1-a');
  if not (r->>'claimed')::boolean and r->>'status' = 'done' then raise notice 'PASS: a finished notification cannot be executed again'; else failures := failures + 1; raise notice 'FAIL: re-claimed a finished notification'; end if;
  r := public.notification_snooze(n_a, 'slice1-key-a-snooze-3');
  if not (r->>'snoozed')::boolean then raise notice 'PASS: a finished notification cannot be snoozed'; else failures := failures + 1; raise notice 'FAIL: finished notification snoozed'; end if;

  -- 5b. A stale claim (app killed mid-action) can be re-claimed, and the OLD claim can no longer finish it
  insert into public.notifications (type, title, dedupe_key, action_kind, action_ref) values ('reminder', 'A second', 'slice1:a:2', 'open', '{}'::jsonb) returning id into n_a2;
  r := public.notification_begin_action(n_a2, 'doit:slice1-a2'); c1 := (r->>'claim_id')::uuid;
  reset role; update public.notifications set action_started_at = now() - interval '3 minutes' where id = n_a2;
  perform set_config('request.jwt.claims', claims_a, true); set local role authenticated;
  r := public.notification_begin_action(n_a2, 'doit:slice1-a2'); c2 := (r->>'claim_id')::uuid;
  if (r->>'claimed')::boolean and c2 <> c1 then raise notice 'PASS: stale claim re-claimed with a new claim id'; else failures := failures + 1; raise notice 'FAIL: stale reclaim %', r; end if;
  begin perform public.notification_finish_action(n_a2, 'doit:slice1-a2', c1, true, 'late'); failures := failures + 1; raise notice 'FAIL: the old claim finished the notification';
  exception when others then raise notice 'PASS: the old claim cannot finish after a re-claim'; end;
  r := public.notification_finish_action(n_a2, 'doit:slice1-a2', c2, false, 'boom');
  if r->>'status' = 'open' then raise notice 'PASS: a failed action releases the claim for retry'; else failures := failures + 1; raise notice 'FAIL: failed finish %', r; end if;

  -- 6. Action audit rows are private
  reset role;
  perform set_config('request.jwt.claims', claims_b, true);
  set local role authenticated;
  select count(*) into cnt from public.notification_actions where notification_id = n_a;
  if cnt = 0 then raise notice 'PASS: B cannot read A''s action audit rows'; else failures := failures + 1; raise notice 'FAIL: B can read A''s audit rows'; end if;

  -- ================= COMMUNITY =================
  reset role;
  perform set_config('request.jwt.claims', claims_a, true);
  set local role authenticated;

  -- 7. A can post, and cannot post as B
  insert into public.community_posts (body) values ('A post') returning id into post_a;
  insert into public.community_comments (post_id, body) values (post_a, 'A comment') returning id into comment_a;
  rejected := false;
  begin
    update public.community_comments set post_id = post_g where id = comment_a;
  exception when others then rejected := true;
  end;
  if rejected then raise notice 'PASS: A cannot move a comment into B''s private group';
  else failures := failures + 1; raise notice 'FAIL: A moved a comment into B''s private group'; end if;
  select post_id into comment_post from public.community_comments where id = comment_a;
  if comment_post = post_a then raise notice 'PASS: rejected comment move leaves its original post unchanged';
  else failures := failures + 1; raise notice 'FAIL: rejected comment move changed its post'; end if;
  rejected := false;
  begin
    update public.community_comments set post_id = post_h where id = comment_a;
  exception when others then rejected := true;
  end;
  if rejected then raise notice 'PASS: A cannot move a comment to a hidden post';
  else failures := failures + 1; raise notice 'FAIL: A moved a comment to a hidden post'; end if;
  rejected := false;
  begin
    update public.community_comments set post_id = post_closed where id = comment_a;
  exception when others then rejected := true;
  end;
  if rejected then raise notice 'PASS: A cannot move a comment to a post with comments closed';
  else failures := failures + 1; raise notice 'FAIL: A moved a comment to a post with comments closed'; end if;
  update public.community_comments set post_id = post_b where id = comment_a;
  select post_id into comment_post from public.community_comments where id = comment_a;
  if comment_post = post_b then raise notice 'PASS: A can move a comment to an eligible public post';
  else failures := failures + 1; raise notice 'FAIL: A could not move a comment to an eligible public post'; end if;
  begin
    insert into public.community_posts (user_id, body) values (b, 'A pretending to be B');
    failures := failures + 1; raise notice 'FAIL: A posted as B';
  exception when others then raise notice 'PASS: A cannot post as B'; end;

  -- 8. Ordinary users cannot moderate: not their own post, not their own profile, not groups
  begin
    update public.community_posts set status = 'hidden' where id = post_a;
    failures := failures + 1; raise notice 'FAIL: author changed own post status';
  exception when others then raise notice 'PASS: author cannot change post moderation status'; end;
  begin
    update public.community_profiles set status = 'suspended' where user_id = a;
    failures := failures + 1; raise notice 'FAIL: member changed own profile status';
  exception when others then raise notice 'PASS: member cannot change own profile status'; end;
  begin
    update public.community_profiles set suspended_reason = 'self-supplied' where user_id = a;
    failures := failures + 1; raise notice 'FAIL: member changed own suspension reason';
  exception when others then raise notice 'PASS: member cannot change own suspension reason'; end;
  update public.community_posts set status = 'removed' where id = post_b;  -- B's post: RLS hides the row, so 0 rows change
  reset role; select status into st from public.community_posts where id = post_b;
  if st = 'visible' then raise notice 'PASS: A cannot moderate B''s post'; else failures := failures + 1; raise notice 'FAIL: B''s post status is now %', st; end if;

  -- 9. user_metadata must never grant admin
  perform set_config('request.jwt.claims', claims_fake, true);
  set local role authenticated;
  begin
    update public.community_profiles set status = 'suspended' where user_id = b;
    reset role; select status into st from public.community_profiles where user_id = b;
    if st = 'suspended' then failures := failures + 1; raise notice 'FAIL: user_metadata admin suspended a member';
    else raise notice 'PASS: user_metadata admin changed nothing'; end if;
  exception when others then raise notice 'PASS: user_metadata admin is refused'; end;
  reset role;

  -- 10. Moderation log: ordinary users cannot read it
  perform set_config('request.jwt.claims', claims_a, true);
  set local role authenticated;
  select count(*) into cnt from public.community_moderation_log;
  if cnt = 0 then raise notice 'PASS: A sees no moderation log rows'; else failures := failures + 1; raise notice 'FAIL: A can read the moderation log'; end if;

  -- 11. A cannot move a post into a private group A does not belong to (migration 008 fix 3)
  begin
    update public.community_posts set group_id = group_b where id = post_a;
    failures := failures + 1; raise notice 'FAIL: A moved a post into B''s private group';
  exception when others then raise notice 'PASS: A cannot move a post into a group A is not a member of'; end;

  -- 12. Private groups are DISCOVERABLE (name/description) but their content is members-only (migration 009, section B)
  select count(*) into cnt from public.community_groups where id = group_b;
  if cnt = 1 then raise notice 'PASS: A can discover B''s private group by name (so A can ask to join)'; else failures := failures + 1; raise notice 'FAIL: private group not discoverable'; end if;
  select count(*) into cnt from public.community_posts where id = post_g;
  if cnt = 0 then raise notice 'PASS: A cannot read posts inside B''s private group'; else failures := failures + 1; raise notice 'FAIL: A reads private-group posts'; end if;
  select count(*) into cnt from public.community_group_members where group_id = group_b;
  if cnt = 0 then raise notice 'PASS: A cannot list the members of B''s private group'; else failures := failures + 1; raise notice 'FAIL: A lists private-group members'; end if;
  begin insert into public.community_posts (body, group_id) values ('sneaky', group_b); failures := failures + 1; raise notice 'FAIL: A posted into B''s private group';
  exception when others then raise notice 'PASS: A cannot post into B''s private group'; end;
  insert into public.community_group_members (group_id, role, status) values (group_b, 'member', 'pending');
  select count(*) into cnt from public.community_posts where id = post_g;
  if cnt = 0 then raise notice 'PASS: a PENDING request still shows no content'; else failures := failures + 1; raise notice 'FAIL: pending member reads content'; end if;
  begin insert into public.community_group_members (group_id, role, status) values (group_b, 'member', 'active'); failures := failures + 1; raise notice 'FAIL: A joined a private group without approval';
  exception when others then raise notice 'PASS: A cannot self-approve into a private group'; end;
  begin update public.community_group_members set status = 'active' where group_id = group_b and user_id = a; reset role; select status into st from public.community_group_members where group_id = group_b and user_id = a;
    if st = 'active' then failures := failures + 1; raise notice 'FAIL: A approved their own request'; else raise notice 'PASS: A cannot approve their own request'; end if;
  exception when others then raise notice 'PASS: A cannot approve their own request'; end;
  perform set_config('request.jwt.claims', claims_a, true); set local role authenticated;

  -- 12b. Storage: who can read which object (this is what signed URLs rely on)
  select count(*) into cnt from storage.objects where bucket_id = 'community-media' and name = pub;
  if cnt = 1 then raise notice 'PASS: A can read the media of a public post'; else failures := failures + 1; raise notice 'FAIL: A cannot read public-post media'; end if;
  select count(*) into cnt from storage.objects where bucket_id = 'community-media' and name = av;
  if cnt = 1 then raise notice 'PASS: A can read an active member''s avatar'; else failures := failures + 1; raise notice 'FAIL: avatar unreadable'; end if;
  select count(*) into cnt from storage.objects where bucket_id = 'community-media' and name = priv;
  if cnt = 0 then raise notice 'PASS: A cannot read media of a private group they are not in'; else failures := failures + 1; raise notice 'FAIL: private-group media readable'; end if;
  select count(*) into cnt from storage.objects where bucket_id = 'community-media' and name = hid;
  if cnt = 0 then raise notice 'PASS: A cannot read media of a hidden post'; else failures := failures + 1; raise notice 'FAIL: hidden-post media readable'; end if;
  select count(*) into cnt from storage.objects where bucket_id = 'community-media' and name = mine;
  if cnt = 1 then raise notice 'PASS: A can read their own folder'; else failures := failures + 1; raise notice 'FAIL: own media unreadable'; end if;
  select count(*) into cnt from storage.objects where bucket_id = 'community-media' and name = b::text || '/never-attached.jpg';
  if cnt = 0 then raise notice 'PASS: an unattached object in B''s folder is not readable by A'; else failures := failures + 1; raise notice 'FAIL: unattached object readable'; end if;
  begin insert into storage.objects (bucket_id, name, owner) values ('community-media', b::text || '/planted.jpg', a); failures := failures + 1; raise notice 'FAIL: A uploaded into B''s folder';
  exception when others then raise notice 'PASS: A cannot upload into B''s folder'; end;

  -- 13. Blocking: after B blocks A, B no longer sees A's posts
  reset role;
  perform set_config('request.jwt.claims', claims_b, true);
  set local role authenticated;
  insert into public.community_blocks (blocked_user_id, blocked_name) values (a, 'Member A');
  select count(*) into cnt from public.community_posts where id = post_a;
  if cnt = 0 then raise notice 'PASS: blocked member''s posts are hidden from the blocker'; else failures := failures + 1; raise notice 'FAIL: B still sees A''s post after blocking'; end if;
  reset role; perform set_config('request.jwt.claims', claims_a, true); set local role authenticated;
  select count(*) into cnt from storage.objects where bucket_id = 'community-media' and name in (pub, av);
  if cnt = 0 then raise notice 'PASS: after B blocks A, A can no longer read B''s media or avatar (signed URLs fail)'; else failures := failures + 1; raise notice 'FAIL: blocked member still reads media'; end if;
  reset role; perform set_config('request.jwt.claims', claims_b, true); set local role authenticated;

  -- 14. A cannot read B's block list or reports
  reset role;
  perform set_config('request.jwt.claims', claims_a, true);
  set local role authenticated;
  select count(*) into cnt from public.community_blocks;
  if cnt = 0 then raise notice 'PASS: A cannot read B''s block list'; else failures := failures + 1; raise notice 'FAIL: A can read blocks'; end if;
  insert into public.community_reports (post_id, reason) values (post_b, 'spam') returning id into report_a;
  begin
    insert into public.community_reports (post_id, reason) values (post_b, 'abuse');
    failures := failures + 1; raise notice 'FAIL: duplicate report accepted';
  exception when others then raise notice 'PASS: one report per member per post'; end;
  begin
    update public.community_reports set status = 'resolved' where post_id = post_b;
    reset role; select count(*) into cnt from public.community_reports where post_id = post_b and status = 'resolved';
    if cnt > 0 then failures := failures + 1; raise notice 'FAIL: reporter resolved their own report'; else raise notice 'PASS: reporter cannot resolve reports'; end if;
  exception when others then raise notice 'PASS: reporter cannot resolve reports'; end;
  reset role;

  -- 15. Administrator (app_metadata) CAN moderate, and it is logged
  perform set_config('request.jwt.claims', claims_c, true);
  set local role authenticated;
  update public.community_posts set status = 'hidden' where id = post_b;
  insert into public.community_moderation_log (action, target_type, target_id, reason) values ('hide_post', 'post', post_b, 'slice1 test');
  reset role; select status into st from public.community_posts where id = post_b;
  if st = 'hidden' then raise notice 'PASS: administrator can hide a post'; else failures := failures + 1; raise notice 'FAIL: administrator could not hide a post'; end if;
  perform set_config('request.jwt.claims', claims_c, true);
  set local role authenticated;
  update public.community_profiles set suspended_reason = 'admin test' where user_id = b;
  update public.community_profiles set status = 'active', suspended_reason = null where user_id = b;
  update public.community_reports set status = 'resolved', resolved_by = c, resolution_note = 'admin test' where id = report_a;
  reset role;
  select status into st from public.community_profiles where user_id = b;
  if st = 'active' then raise notice 'PASS: administrator can moderate and restore a community profile'; else failures := failures + 1; raise notice 'FAIL: administrator profile moderation failed'; end if;
  select count(*) into cnt from public.community_reports where id = report_a and status = 'resolved' and resolved_by = c and resolution_note = 'admin test';
  if cnt = 1 then raise notice 'PASS: administrator can resolve a report and set resolution fields'; else failures := failures + 1; raise notice 'FAIL: administrator report resolution failed'; end if;
  perform set_config('request.jwt.claims', claims_c, true);
  set local role authenticated;
  select count(*) into cnt from public.community_moderation_log;
  if cnt >= 1 then raise notice 'PASS: administrator can read the moderation log'; else failures := failures + 1; raise notice 'FAIL: administrator cannot read the moderation log'; end if;
  reset role;

  perform set_config('request.jwt.claims', claims_c, true); set local role authenticated;
  select count(*) into cnt from storage.objects where bucket_id = 'community-media' and name in (priv, hid, pub);
  if cnt = 3 then raise notice 'PASS: administrator can read private-group and hidden-post media'; else failures := failures + 1; raise notice 'FAIL: administrator media access (% of 3)', cnt; end if;
  reset role;
  perform set_config('request.jwt.claims', claims_fake, true); set local role authenticated;
  select count(*) into cnt from storage.objects where bucket_id = 'community-media' and name in (priv, hid);
  if cnt = 0 then raise notice 'PASS: user_metadata admin cannot read private/hidden media'; else failures := failures + 1; raise notice 'FAIL: user_metadata admin reads private media'; end if;
  reset role;

  -- 16. Anonymous role has no access
  set local role anon;
  begin
    perform count(*) from public.community_posts;
    failures := failures + 1; raise notice 'FAIL: anon can query community_posts';
  exception when others then raise notice 'PASS: anon cannot query community_posts'; end;
  reset role;

  raise notice '=== Slice 1 permission test finished: % failures ===', failures;
end
$$;

rollback;
