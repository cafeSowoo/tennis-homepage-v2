-- Run whole file: synthetic accounts, members and all changes are rolled back.
begin;
do $$
declare target uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); admin_user uuid:=gen_random_uuid();
 target_member text:='__link_test_'||target; admin_member text:='__link_admin_'||admin_user;
begin
 insert into auth.users(id,raw_app_meta_data) values(target,'{"provider":"kakao"}'),(other_user,'{"provider":"kakao"}'),(admin_user,'{"provider":"kakao"}');
 insert into public.members(id,name,status) values(target_member,'연결 테스트','active'),(admin_member,'관리자 테스트','active');
 insert into public.club_member_accounts(user_id) values(target),(other_user);
 insert into public.club_member_accounts(user_id,member_id,status,role) values(admin_user,admin_member,'approved','admin');
 perform set_config('linktest.target',target::text,true);
 perform set_config('linktest.other',other_user::text,true);
 perform set_config('linktest.admin',admin_user::text,true);
 perform set_config('linktest.member',target_member,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',target,'role','authenticated')::text,true);
end $$;
set local role authenticated;
do $$
declare a public.club_member_accounts; initial_version timestamptz; changed integer;
begin
 select updated_at into initial_version from public.club_member_accounts where user_id=auth.uid();
 if not exists(select 1 from public.v2_member_link_candidates() where id=current_setting('linktest.member')) then raise exception 'Candidate missing'; end if;
 select * into a from public.v2_submit_member_request('existing',current_setting('linktest.member'),'forged name');
 if a.requested_name<>'연결 테스트' or a.member_id is not null or a.status<>'pending' or a.role<>'member' or a.approved_at is not null then raise exception 'Request changed authorization'; end if;
 update public.club_member_accounts set status='approved',member_id=current_setting('linktest.member') where user_id=auth.uid();
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'Direct self approval allowed'; end if;
 if exists(select 1 from public.club_member_accounts where user_id=current_setting('linktest.other')::uuid) then raise exception 'Other account exposed'; end if;
 begin
  perform public.v2_submit_member_request('new',null,'  ');
  raise exception 'Empty name accepted';
 exception when invalid_parameter_value then null; end;
 select * into a from public.v2_submit_member_request('new',null,' 신규 테스트 ');
 if a.requested_member_id is not null or a.requested_name<>'신규 테스트' then raise exception 'New request invalid'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('linktest.admin'),'role','authenticated')::text,true);
 begin
  perform public.v2_admin_manage_account(a.user_id,current_setting('linktest.member'),'approved',initial_version);
  raise exception 'Stale approval accepted';
 exception when serialization_failure then null; end;
 select * into a from public.v2_admin_manage_account(a.user_id,current_setting('linktest.member'),'approved',a.updated_at);
 if a.status<>'approved' or a.member_id<>current_setting('linktest.member') then raise exception 'Approval failed'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('linktest.target'),'role','authenticated')::text,true);
 begin
  perform public.v2_submit_member_request('new',null,'another name');
  raise exception 'Approved request accepted';
 exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
 begin
  perform public.v2_member_link_candidates();
  raise exception 'Anonymous candidates allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.v2_submit_member_request('new',null,'anonymous');
  raise exception 'Anonymous request allowed';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
select 'PASS: existing/new request, ownership, no self approval, stale approval guard, admin approval, approved/anonymous denial; all fixtures rolled back' as result;
