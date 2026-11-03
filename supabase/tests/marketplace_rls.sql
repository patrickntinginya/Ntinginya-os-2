-- Marketplace ownership, review, booking-conflict, and notification regressions.
-- Transactional and intended only for the disposable local PostgreSQL harness.
begin;
do $$
declare
  admin_id uuid := '00000000-0000-0000-0000-0000000000a1';
  pro_id uuid := '00000000-0000-0000-0000-0000000000b1';
  other_pro_id uuid := '00000000-0000-0000-0000-0000000000b2';
  client_id uuid := '00000000-0000-0000-0000-0000000000c1';
  other_client_id uuid := '00000000-0000-0000-0000-0000000000c2';
  inst uuid := '00000000-0000-0000-0000-000000000000';
  service_id uuid;
  booking_id uuid;
  second_booking_id uuid;
  booking_start timestamptz := now() + interval '2 days';
  affected integer;
  professional_status text;
  failures integer := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at) values
    (admin_id, inst, 'authenticated', 'authenticated', 'market-admin@example.test', '{}', '{"role":"admin"}', now(), now()),
    (pro_id, inst, 'authenticated', 'authenticated', 'market-pro@example.test', '{}', '{}', now(), now()),
    (other_pro_id, inst, 'authenticated', 'authenticated', 'market-other-pro@example.test', '{}', '{}', now(), now()),
    (client_id, inst, 'authenticated', 'authenticated', 'market-client@example.test', '{}', '{}', now(), now()),
    (other_client_id, inst, 'authenticated', 'authenticated', 'market-other-client@example.test', '{}', '{}', now(), now());

  perform set_config('request.jwt.claims', json_build_object('sub', pro_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.marketplace_professionals
      (display_name, category, skills, experience_years, location, description, photo_path)
    values ('Professional A', 'health', array['counselling'], 5, 'Dar es Salaam', repeat('Professional profile description. ', 2), pro_id::text || '/missing.webp');
    failures := failures + 1; raise notice 'FAIL: professional profile accepted a missing photo';
  exception when check_violation then raise notice 'PASS: missing professional photo is rejected'; end;
  insert into storage.objects (bucket_id, name, metadata)
  values ('professional-media', pro_id::text || '/wrong.webp', '{"mimetype":"text/plain","size":1024}');
  begin
    insert into public.marketplace_professionals
      (display_name, category, skills, experience_years, location, description, photo_path)
    values ('Professional A', 'health', array['counselling'], 5, 'Dar es Salaam', repeat('Professional profile description. ', 2), pro_id::text || '/wrong.webp');
    failures := failures + 1; raise notice 'FAIL: professional profile accepted a non-image photo';
  exception when check_violation then raise notice 'PASS: non-image professional photo is rejected'; end;
  insert into storage.objects (bucket_id, name, metadata)
  values ('professional-media', pro_id::text || '/oversized.webp', '{"mimetype":"image/webp","size":5242881}');
  begin
    insert into public.marketplace_professionals
      (display_name, category, skills, experience_years, location, description, photo_path)
    values ('Professional A', 'health', array['counselling'], 5, 'Dar es Salaam', repeat('Professional profile description. ', 2), pro_id::text || '/oversized.webp');
    failures := failures + 1; raise notice 'FAIL: professional profile accepted an oversized photo';
  exception when check_violation then raise notice 'PASS: oversized professional photo is rejected'; end;
  insert into storage.objects (bucket_id, name, metadata)
  values ('professional-media', pro_id::text || '/photo.webp', '{"mimetype":"image/webp","size":1024}');
  insert into public.marketplace_professionals
    (display_name, category, skills, experience_years, location, description, photo_path)
  values ('Professional A', 'health', array['counselling'], 5, 'Dar es Salaam', repeat('Professional profile description. ', 2), pro_id::text || '/photo.webp');
  begin
    update public.marketplace_professionals set status = 'approved' where user_id = pro_id;
    failures := failures + 1; raise notice 'FAIL: professional approved own profile';
  exception when insufficient_privilege then raise notice 'PASS: professional cannot approve own profile'; end;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', other_pro_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, metadata)
  values ('professional-media', other_pro_id::text || '/photo.webp', '{"mimetype":"image/webp","size":1024}');
  insert into public.marketplace_professionals
    (display_name, category, skills, experience_years, location, description, photo_path)
  values ('Professional B', 'education', array['tutoring'], 3, 'Arusha', repeat('Professional profile description. ', 2), other_pro_id::text || '/photo.webp');

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated', 'app_metadata', json_build_object('role','admin'))::text, true);
  set local role authenticated;
  update public.marketplace_professionals set status = 'approved' where user_id = pro_id;
  get diagnostics affected = row_count;
  if affected = 1 then raise notice 'PASS: admin approved a professional'; else failures := failures + 1; raise notice 'FAIL: admin could not approve professional'; end if;
  update public.marketplace_professionals set status = 'approved' where user_id = other_pro_id;
  insert into storage.objects (bucket_id, name, metadata)
  values ('professional-media', admin_id::text || '/photo.webp', '{"mimetype":"image/webp","size":1024}');
  insert into public.marketplace_professionals
    (user_id, display_name, category, skills, experience_years, location, description, photo_path)
  values (admin_id, 'Admin Professional', 'other', array['admin'], 1, 'Dodoma', repeat('Professional profile description. ', 2), admin_id::text || '/photo.webp');
  begin
    update public.marketplace_professionals set status = 'approved' where user_id = admin_id;
    failures := failures + 1; raise notice 'FAIL: admin approved own professional profile';
  exception when insufficient_privilege then raise notice 'PASS: admin cannot self-approve a professional profile'; end;

  reset role;
  update public.marketplace_professionals set status = 'rejected' where user_id = pro_id;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', pro_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.marketplace_professionals set status = 'pending' where user_id = pro_id;
  get diagnostics affected = row_count;
  if affected = 1 then raise notice 'PASS: professional can resubmit a rejected application'; else failures := failures + 1; raise notice 'FAIL: rejected application could not be resubmitted'; end if;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated', 'app_metadata', json_build_object('role','admin'))::text, true);
  set local role authenticated;
  update public.marketplace_professionals set status = 'approved' where user_id = pro_id;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', pro_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.marketplace_professionals set description = repeat('Updated professional profile description. ', 2) where user_id = pro_id;
  select status into strict professional_status from public.marketplace_professionals where user_id = pro_id;
  if professional_status = 'pending' then raise notice 'PASS: edits to verified profile require a new review'; else failures := failures + 1; raise notice 'FAIL: verified profile edits bypassed review'; end if;
  begin
    update public.marketplace_professionals set status = 'suspended' where user_id = other_pro_id;
    get diagnostics affected = row_count;
    if affected = 0 then raise notice 'PASS: professional cannot moderate another professional'; else failures := failures + 1; raise notice 'FAIL: professional moderated another professional'; end if;
  exception when insufficient_privilege then raise notice 'PASS: professional cannot moderate another professional'; end;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated', 'app_metadata', json_build_object('role','admin'))::text, true);
  set local role authenticated;
  update public.marketplace_professionals set status = 'approved' where user_id = pro_id;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', pro_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.marketplace_services (professional_id, title, category, description, price_tzs, duration_minutes)
  values (pro_id, 'Consultation', 'health', repeat('Service description. ', 2), 25000, 60)
  returning id into service_id;
  begin
    update public.marketplace_services set status = 'active' where id = service_id;
    failures := failures + 1; raise notice 'FAIL: professional activated own service';
  exception when insufficient_privilege then raise notice 'PASS: professional cannot activate own service'; end;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated', 'app_metadata', json_build_object('role','admin'))::text, true);
  set local role authenticated;
  update public.marketplace_services set status = 'active' where id = service_id;
  get diagnostics affected = row_count;
  if affected = 1 then raise notice 'PASS: admin activated a service for an approved professional'; else failures := failures + 1; raise notice 'FAIL: admin could not activate service'; end if;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', client_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.marketplace_appointments (professional_id, service_id, starts_at, ends_at, message)
  values (pro_id, service_id, booking_start, booking_start + interval '60 minutes', 'First request')
  returning id into booking_id;
  begin
    update public.marketplace_appointments set status = 'accepted' where id = booking_id;
    failures := failures + 1; raise notice 'FAIL: client accepted own appointment request';
  exception when insufficient_privilege then raise notice 'PASS: client cannot accept their own appointment request'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', other_client_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.marketplace_appointments (professional_id, service_id, starts_at, ends_at)
  values (pro_id, service_id, booking_start + interval '30 minutes', booking_start + interval '90 minutes')
  returning id into second_booking_id;
  raise notice 'PASS: overlapping requests remain pending until a professional accepts one';
  select count(*) into affected from public.marketplace_appointments where user_id = client_id;
  if affected = 0 then raise notice 'PASS: client cannot read another client booking'; else failures := failures + 1; raise notice 'FAIL: client read another client booking'; end if;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', pro_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into affected from public.marketplace_appointments where professional_id = pro_id;
  if affected = 2 then raise notice 'PASS: professional can view their appointment requests'; else failures := failures + 1; raise notice 'FAIL: professional appointment history missing'; end if;
  update public.marketplace_appointments set status = 'accepted' where id = booking_id;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', client_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into affected from public.notifications where user_id = client_id and type = 'appointment';
  if affected = 1 then raise notice 'PASS: status change created a private client notification'; else failures := failures + 1; raise notice 'FAIL: appointment status notification missing'; end if;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', pro_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.marketplace_appointments set status = 'accepted' where user_id = other_client_id;
    failures := failures + 1; raise notice 'FAIL: overlapping appointment was accepted';
  exception when exclusion_violation then raise notice 'PASS: confirmed appointment conflict is rejected'; end;
  begin
    update public.marketplace_appointments set status = 'completed' where id = second_booking_id;
    failures := failures + 1; raise notice 'FAIL: professional skipped required appointment status transition';
  exception when insufficient_privilege then raise notice 'PASS: professional appointment status transitions are constrained'; end;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated', 'app_metadata', json_build_object('role','admin'))::text, true);
  set local role authenticated;
  update public.marketplace_appointments set status = 'rejected' where id = second_booking_id;
  get diagnostics affected = row_count;
  if affected = 1 then raise notice 'PASS: admin can moderate an appointment'; else failures := failures + 1; raise notice 'FAIL: admin could not moderate an appointment'; end if;
  update public.marketplace_services set status = 'suspended' where id = service_id;
  get diagnostics affected = row_count;
  if affected = 1 then raise notice 'PASS: admin can suspend a service'; else failures := failures + 1; raise notice 'FAIL: admin could not suspend a service'; end if;
  update public.marketplace_professionals set status = 'suspended' where user_id = pro_id;
  get diagnostics affected = row_count;
  if affected = 1 then raise notice 'PASS: admin can suspend a professional'; else failures := failures + 1; raise notice 'FAIL: admin could not suspend a professional'; end if;

  reset role;
  begin
    delete from auth.users where id = pro_id;
    failures := failures + 1;
    raise notice 'FAIL: professional account deletion removed referenced appointment history';
  exception when foreign_key_violation then
    raise notice 'PASS: professional account deletion is blocked while appointments reference the profile';
  end;
  select count(*) into affected
  from public.marketplace_appointments a
  join public.marketplace_professionals p on p.user_id = a.professional_id
  join public.marketplace_services s on s.id = a.service_id
  where a.user_id in (client_id, other_client_id)
    and p.display_name = 'Professional A'
    and s.title = 'Consultation';
  if affected = 2 then
    raise notice 'PASS: both clients'' appointment histories remain intact after deletion is blocked';
  else
    failures := failures + 1;
    raise notice 'FAIL: blocking professional deletion did not preserve appointment history';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', client_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into affected from public.marketplace_appointments where user_id = client_id;
  if affected = 1 then raise notice 'PASS: client can still read retained appointment history'; else failures := failures + 1; raise notice 'FAIL: client cannot read retained appointment history'; end if;
  select count(*) into affected from public.marketplace_appointments where user_id = other_client_id;
  if affected = 0 then raise notice 'PASS: retained appointment history remains private to its client'; else failures := failures + 1; raise notice 'FAIL: client read another client''s retained appointment history'; end if;

  reset role;
  set local role anon;
  begin
    perform count(*) from public.marketplace_appointments;
    failures := failures + 1; raise notice 'FAIL: anonymous role read marketplace appointments';
  exception when insufficient_privilege then raise notice 'PASS: anonymous role cannot read marketplace appointments'; end;

  reset role;
  if failures > 0 then raise exception 'marketplace_rls had % failure(s)', failures; end if;
  raise notice 'marketplace_rls: 0 failures';
end $$;
rollback;
