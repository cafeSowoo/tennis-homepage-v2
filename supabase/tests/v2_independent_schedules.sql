-- Run inside BEGIN/ROLLBACK. Fixtures never use or modify real member accounts.
create temporary table v2_test_results(name text);
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'FAIL: %',label; end if;
 insert into v2_test_results values(label);
end $$;
create function pg_temp.expect_error(command text, codes text[], label text) returns void language plpgsql as $$
begin
 begin
  execute command;
 exception when others then
  if sqlstate=any(codes) then insert into v2_test_results values(label); return; end if;
  raise;
 end;
 raise exception 'FAIL: expected denial: %',label;
end $$;
grant all on v2_test_results to authenticated,anon;
select set_config('v2test.user_a',gen_random_uuid()::text,true),
 set_config('v2test.user_b',gen_random_uuid()::text,true),
 set_config('v2test.user_pending',gen_random_uuid()::text,true),
 set_config('v2test.schedule',gen_random_uuid()::text,true),
 set_config('v2test.comment',gen_random_uuid()::text,true);
select set_config('v2test.member_a','__v2test_'||current_setting('v2test.user_a'),true),
 set_config('v2test.member_b','__v2test_'||current_setting('v2test.user_b'),true),
 set_config('v2test.court','__v2test_'||gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('v2test.user_a')::uuid),(current_setting('v2test.user_b')::uuid),(current_setting('v2test.user_pending')::uuid);
insert into public.members(id,name,status) values
 (current_setting('v2test.member_a'),'V2 test A','active'),(current_setting('v2test.member_b'),'V2 test B','active');
insert into public.courts(id,name) values(current_setting('v2test.court'),'V2 test court');
insert into public.club_member_accounts(user_id,member_id,status,role) values
 (current_setting('v2test.user_a')::uuid,current_setting('v2test.member_a'),'approved','member'),
 (current_setting('v2test.user_b')::uuid,current_setting('v2test.member_b'),'approved','member'),
 (current_setting('v2test.user_pending')::uuid,null,'pending','member');
select set_config('v2test.payload',jsonb_build_object('title','V2 fixture','starts_at',now()+interval '2 days',
 'ends_at',now()+interval '2 days 2 hours','court_id',current_setting('v2test.court'),'capacity',1)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('v2test.user_a'),'role','authenticated')::text,true);
set local role authenticated;
select public.v2_create_schedule(current_setting('v2test.schedule')::uuid,current_setting('v2test.payload')::jsonb);
select public.v2_create_schedule(current_setting('v2test.schedule')::uuid,current_setting('v2test.payload')::jsonb);
select pg_temp.check_true((select count(*)=1 from public.v2_schedules where id=current_setting('v2test.schedule')::uuid),'create retry is idempotent');
select pg_temp.check_true((select creator_member_id=current_setting('v2test.member_a') and version=1 from public.v2_schedules where id=current_setting('v2test.schedule')::uuid),'server owns creator identity');
select pg_temp.expect_error($q$select public.v2_create_schedule(gen_random_uuid(),current_setting('v2test.payload')::jsonb||'{"creator_member_id":"forged"}')$q$,array['22023'],'identity injection rejected');
select pg_temp.expect_error($q$select public.v2_create_schedule(gen_random_uuid(),current_setting('v2test.payload')::jsonb||'{"capacity":0}')$q$,array['22023'],'invalid capacity');
select pg_temp.expect_error($q$select public.v2_create_schedule(gen_random_uuid(),current_setting('v2test.payload')::jsonb||'{"court_unit_id":"wrong"}')$q$,array['22023'],'wrong court unit');
select pg_temp.expect_error($q$update public.v2_schedules set title='bypass'$q$,array['42501'],'direct schedule mutation denied');
select pg_temp.expect_error($q$delete from public.v2_schedules$q$,array['42501'],'hard deletion denied');
select public.v2_set_my_rsvp(current_setting('v2test.schedule')::uuid,'attending');
select pg_temp.check_true((select count(*)=1 from public.v2_schedule_rsvps where schedule_id=current_setting('v2test.schedule')::uuid and member_id=current_setting('v2test.member_a')),'self RSVP');
select public.v2_add_discussion(current_setting('v2test.comment')::uuid,current_setting('v2test.schedule')::uuid,'hello');
select public.v2_add_discussion(current_setting('v2test.comment')::uuid,current_setting('v2test.schedule')::uuid,'hello');
select pg_temp.check_true((select count(*)=1 from public.v2_discussions where id=current_setting('v2test.comment')::uuid),'comment retry is idempotent');
select pg_temp.expect_error($q$select public.v2_add_discussion(gen_random_uuid(),current_setting('v2test.schedule')::uuid,' ')$q$,array['22023'],'blank comment denied');
select pg_temp.expect_error($q$select public.v2_add_discussion(gen_random_uuid(),current_setting('v2test.schedule')::uuid,repeat('x',2001))$q$,array['22023'],'long comment denied');
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('v2test.user_b'),'role','authenticated')::text,true);
select pg_temp.expect_error($q$select public.v2_update_schedule(current_setting('v2test.schedule')::uuid,1,current_setting('v2test.payload')::jsonb)$q$,array['42501'],'other member edit denied');
select pg_temp.expect_error($q$select public.v2_cancel_schedule(current_setting('v2test.schedule')::uuid,1)$q$,array['42501'],'other member cancel denied');
select pg_temp.expect_error($q$select public.v2_set_my_rsvp(current_setting('v2test.schedule')::uuid,'attending')$q$,array['22023'],'capacity enforced');
select pg_temp.check_true(not public.v2_delete_discussion(current_setting('v2test.comment')::uuid),'other comment delete denied');
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('v2test.user_a'),'role','authenticated')::text,true);
select public.v2_update_schedule(current_setting('v2test.schedule')::uuid,1,current_setting('v2test.payload')::jsonb||'{"registration_closed":true,"title":"Edited"}');
select pg_temp.check_true((select count(*)=1 from public.v2_schedule_rsvps where schedule_id=current_setting('v2test.schedule')::uuid and state='attending'),'metadata edit preserves RSVP');
select pg_temp.expect_error($q$select public.v2_update_schedule(current_setting('v2test.schedule')::uuid,1,current_setting('v2test.payload')::jsonb)$q$,array['40001'],'stale edit denied');
select public.v2_set_my_rsvp(current_setting('v2test.schedule')::uuid,'declined');
select pg_temp.expect_error($q$select public.v2_set_my_rsvp(current_setting('v2test.schedule')::uuid,'attending')$q$,array['42501'],'closed schedule blocks new attendance');
select public.v2_cancel_schedule(current_setting('v2test.schedule')::uuid,2);
select public.v2_cancel_schedule(current_setting('v2test.schedule')::uuid,2);
select pg_temp.check_true((select version=3 and status='cancelled' from public.v2_schedules where id=current_setting('v2test.schedule')::uuid),'cancel retry preserves version');
select pg_temp.expect_error($q$select public.v2_set_my_rsvp(current_setting('v2test.schedule')::uuid,'pending')$q$,array['42501'],'cancel blocks RSVP');
select pg_temp.expect_error($q$select public.v2_add_discussion(gen_random_uuid(),current_setting('v2test.schedule')::uuid,'new')$q$,array['42501'],'cancel blocks new comment');
select pg_temp.check_true(public.v2_delete_discussion(current_setting('v2test.comment')::uuid),'own comment deletion allowed after cancel');
select pg_temp.check_true((select count(*)=1 from public.v2_schedule_rsvps where schedule_id=current_setting('v2test.schedule')::uuid),'cancel preserves responses');
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('v2test.user_pending'),'role','authenticated')::text,true);
select pg_temp.check_true((select count(*)=0 from public.v2_schedules),'pending cannot read');
select pg_temp.expect_error($q$select public.v2_create_schedule(gen_random_uuid(),current_setting('v2test.payload')::jsonb)$q$,array['42501'],'pending cannot create');
reset role;
update public.club_member_accounts set status='disabled' where user_id=current_setting('v2test.user_a')::uuid;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('v2test.user_a'),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.check_true((select count(*)=0 from public.v2_schedules),'disabled cannot read');
select pg_temp.expect_error($q$select public.v2_create_schedule(gen_random_uuid(),current_setting('v2test.payload')::jsonb)$q$,array['42501'],'disabled cannot create');
reset role;
update public.club_member_accounts set status='approved' where user_id=current_setting('v2test.user_a')::uuid;
update public.members set status='inactive' where id=current_setting('v2test.member_a');
set local role authenticated;
select pg_temp.check_true((select count(*)=0 from public.v2_schedules),'inactive cannot read');
select pg_temp.expect_error($q$select public.v2_create_schedule(gen_random_uuid(),current_setting('v2test.payload')::jsonb)$q$,array['42501'],'inactive cannot create');
reset role;
set local role anon;
select pg_temp.expect_error('select * from public.v2_schedules',array['42501'],'anonymous read denied');
select pg_temp.expect_error($q$select public.v2_set_my_rsvp(current_setting('v2test.schedule')::uuid,'attending')$q$,array['42501'],'anonymous RPC denied');
reset role;
-- Start-time boundary, admin rights, empty defaults and direct child writes.
update public.members set status='active' where id=current_setting('v2test.member_a');
update public.club_member_accounts set role='admin' where user_id=current_setting('v2test.user_b')::uuid;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('v2test.user_a'),'role','authenticated')::text,true);
select set_config('v2test.next',gen_random_uuid()::text,true);
set local role authenticated;
select public.v2_create_schedule(current_setting('v2test.next')::uuid,current_setting('v2test.payload')::jsonb-'capacity');
select pg_temp.check_true((select capacity=16 from public.v2_schedules where id=current_setting('v2test.next')::uuid),'default capacity 16');
select pg_temp.check_true((select count(*)=0 from public.v2_schedule_rsvps where schedule_id=current_setting('v2test.next')::uuid),'creator not automatically attending');
select pg_temp.expect_error($q$insert into public.v2_schedule_rsvps values(current_setting('v2test.next')::uuid,'forged','attending',now(),current_setting('v2test.user_a')::uuid)$q$,array['42501'],'direct RSVP insert denied');
select pg_temp.expect_error($q$delete from public.v2_discussions$q$,array['42501'],'direct comment mutation denied');
select public.v2_set_my_rsvp(current_setting('v2test.next')::uuid,'attending');
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('v2test.user_b'),'role','authenticated')::text,true);
select public.v2_set_my_rsvp(current_setting('v2test.next')::uuid,'attending');
select pg_temp.expect_error($q$select public.v2_update_schedule(current_setting('v2test.next')::uuid,1,current_setting('v2test.payload')::jsonb)$q$,array['22023'],'capacity cannot evict attendees');
select public.v2_update_schedule(current_setting('v2test.next')::uuid,1,current_setting('v2test.payload')::jsonb||'{"capacity":3}');
select pg_temp.check_true((select creator_member_id=current_setting('v2test.member_a') and version=2 from public.v2_schedules where id=current_setting('v2test.next')::uuid),'admin edits without taking ownership');
reset role;
update public.v2_schedules set starts_at=now()-interval '1 minute' where id=current_setting('v2test.next')::uuid;
set local role authenticated;
select pg_temp.expect_error($q$select public.v2_set_my_rsvp(current_setting('v2test.next')::uuid,'declined')$q$,array['42501'],'started RSVP immutable');
select pg_temp.expect_error($q$select public.v2_update_schedule(current_setting('v2test.next')::uuid,2,current_setting('v2test.payload')::jsonb)$q$,array['42501'],'started editing denied even for admin');
select public.v2_add_discussion(gen_random_uuid(),current_setting('v2test.next')::uuid,'post match comment');
select public.v2_cancel_schedule(current_setting('v2test.next')::uuid,2);
select pg_temp.check_true((select status='cancelled' from public.v2_schedules where id=current_setting('v2test.next')::uuid),'admin can cancel started schedule');
reset role;
set local role authenticated;
select pg_temp.expect_error($q$select public.v2_update_schedule(gen_random_uuid(),null,current_setting('v2test.payload')::jsonb)$q$,array['22023'],'update cannot create with missing version');
select pg_temp.expect_error($q$select public.v2_create_schedule(gen_random_uuid(),current_setting('v2test.payload')::jsonb||jsonb_build_object('title',chr(9)||chr(10)))$q$,array['23514','22023'],'whitespace-only title denied');
select count(*) as passed_checks from v2_test_results;
reset role;
