-- Always run the entire file: all synthetic identities and approval changes roll back.
begin;
do $$
declare actor uuid:=gen_random_uuid(); target uuid:=gen_random_uuid();
 actor_member text:='__v2test_admin_'||actor; target_member text:='__v2test_target_'||target;
begin
 insert into auth.users(id,raw_app_meta_data) values(actor,'{"provider":"kakao"}'),(target,'{"provider":"kakao"}');
 insert into public.members(id,name,status) values(actor_member,'V2 admin fixture','active'),(target_member,'V2 target fixture','active');
 insert into public.club_member_accounts(user_id,member_id,status,role) values(actor,actor_member,'approved','admin'),(target,null,'pending','member');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 perform set_config('v2test.target',target::text,true);
 perform set_config('v2test.member',target_member,true);
end $$;
set local role authenticated;
do $$
declare a public.club_member_accounts; r public.club_member_accounts; target uuid:=current_setting('v2test.target')::uuid;
begin
 select * into a from public.club_member_accounts where user_id=target;
 select * into r from public.v2_admin_manage_account(target,current_setting('v2test.member'),'approved',a.updated_at);
 if r.status<>'approved' or r.role<>'member' or r.approved_at is null then raise exception 'Approval failed'; end if;
 begin
  perform public.v2_admin_manage_account(target,current_setting('v2test.member'),'disabled',a.updated_at);
  raise exception 'Stale request accepted';
 exception when serialization_failure then null; end;
 select * into r from public.v2_admin_manage_account(target,r.member_id,'disabled',r.updated_at);
 if r.status<>'disabled' or r.member_id<>current_setting('v2test.member') then raise exception 'Disable failed'; end if;
 select * into r from public.v2_admin_manage_account(target,r.member_id,'approved',r.updated_at);
 if r.status<>'approved' then raise exception 'Resume failed'; end if;
 begin
  perform public.v2_admin_manage_account(auth.uid(),null,'disabled',r.updated_at);
  raise exception 'Self modification accepted';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',target,'role','authenticated')::text,true);
 begin
  perform public.v2_admin_list_accounts(0);
  raise exception 'Member read accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform public.v2_admin_manage_account(target,r.member_id,'disabled',r.updated_at);
  raise exception 'Member write accepted';
 exception when insufficient_privilege then null; end;
end $$;
select 'PASS: approval, stale conflict, disable, resume, self protection, member read/write denial' as result;
rollback;
