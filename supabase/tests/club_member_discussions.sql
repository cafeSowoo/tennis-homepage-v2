-- Run as a database administrator inside BEGIN / ROLLBACK. Never COMMIT this test.
-- Uses an existing approved Kakao member; all fixtures and status changes roll back.
set local statement_timeout = '20s';
select set_config('v2.test_user_id', (select user_id::text from public.club_member_accounts where provider='kakao' and status='approved' and role='member' order by created_at limit 1), true);
select set_config('v2.test_member_id', (select member_id from public.club_member_accounts where user_id=current_setting('v2.test_user_id')::uuid), true);
do $$ begin
  if nullif(current_setting('v2.test_member_id'),'') is null then raise exception 'Approved Kakao member fixture required'; end if;
end $$;
insert into public.schedules(id,date,day,time,title) values ('__club_discussion_test',current_date,'목','09:00-10:00','Rollback-only member test');
insert into public.discussions(id,schedule_id,member_id,message,source) values
('__club_comment_other','__club_discussion_test',(select min(id) from public.members where id<>current_setting('v2.test_member_id')),'Other homepage comment','supabase'),
('__club_comment_kakao','__club_discussion_test',current_setting('v2.test_member_id'),'Imported Kakao comment','kakao'),
('__club_comment_seed','__club_discussion_test',current_setting('v2.test_member_id'),'Own historical comment','seed');
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('v2.test_user_id'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare n integer; own_id text := current_setting('v2.test_member_id'); begin
  insert into public.discussions(id,schedule_id,member_id,message,source) values ('__club_comment_own','__club_discussion_test',own_id,'Own comment','supabase');
  delete from public.discussions where id='__club_comment_own'; get diagnostics n=row_count;
  if n<>1 then raise exception 'Own deletion failed'; end if;
  delete from public.discussions where id='__club_comment_seed'; get diagnostics n=row_count;
  if n<>1 then raise exception 'Own historical deletion failed'; end if;
  delete from public.discussions where id in ('__club_comment_other','__club_comment_kakao'); get diagnostics n=row_count;
  if n<>0 then raise exception 'Other or imported comment deletion allowed'; end if;
  update public.discussions set member_id=own_id where id='__club_comment_other'; get diagnostics n=row_count;
  if n<>0 then raise exception 'Comment ownership overwrite allowed'; end if;
  begin
    insert into public.discussions(id,schedule_id,member_id,message,source) values ('__club_bad','__club_discussion_test',(select min(id) from public.members where id<>own_id),'Impersonation','supabase');
    raise exception 'Other member insertion allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.discussions(id,schedule_id,member_id,message,source) values ('__club_bad','__club_discussion_test',own_id,'Fake import','kakao');
    raise exception 'Source forgery allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.discussions(id,schedule_id,member_id,message,source) values ('__club_bad','__club_discussion_test',own_id,'   ','supabase');
    raise exception 'Blank comment allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.discussions(id,schedule_id,member_id,message,source) values ('__club_bad','__club_discussion_test',own_id,repeat('x',2001),'supabase');
    raise exception 'Oversized comment allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- disabled members: neither comments nor RSVP.
update public.club_member_accounts set status='disabled' where user_id=current_setting('v2.test_user_id')::uuid;
set local role authenticated;
do $$ begin
  begin
    insert into public.discussions(id,schedule_id,member_id,message,source) values ('__club_bad','__club_discussion_test',current_setting('v2.test_member_id'),'Blocked user','supabase');
    raise exception 'disabled comment accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_my_schedule_rsvp('__club_discussion_test','attending');
    raise exception 'disabled RSVP accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.club_member_accounts set status='approved' where user_id=current_setting('v2.test_user_id')::uuid;

-- pending members: neither comments nor RSVP.
update public.club_member_accounts set status='pending' where user_id=current_setting('v2.test_user_id')::uuid;
set local role authenticated;
do $$ begin
  begin
    insert into public.discussions(id,schedule_id,member_id,message,source) values ('__club_bad','__club_discussion_test',current_setting('v2.test_member_id'),'Blocked user','supabase');
    raise exception 'pending comment accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_my_schedule_rsvp('__club_discussion_test','attending');
    raise exception 'pending RSVP accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.club_member_accounts set status='approved' where user_id=current_setting('v2.test_user_id')::uuid;

-- inactive members: neither comments nor RSVP.
update public.members set status='inactive' where id=current_setting('v2.test_member_id');
set local role authenticated;
do $$ begin
  begin
    insert into public.discussions(id,schedule_id,member_id,message,source) values ('__club_bad','__club_discussion_test',current_setting('v2.test_member_id'),'Blocked user','supabase');
    raise exception 'inactive comment accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_my_schedule_rsvp('__club_discussion_test','attending');
    raise exception 'inactive RSVP accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.members set status='active' where id=current_setting('v2.test_member_id');

-- Approved club admins can delete other homepage comments, not imported Kakao rows.
update public.club_member_accounts set role='admin' where user_id=current_setting('v2.test_user_id')::uuid;
set local role authenticated;
do $$ declare n integer; begin
  delete from public.discussions where id='__club_comment_other'; get diagnostics n=row_count;
  if n<>1 then raise exception 'Club admin deletion failed'; end if;
  delete from public.discussions where id='__club_comment_kakao'; get diagnostics n=row_count;
  if n<>0 then raise exception 'Club admin deleted Kakao import'; end if;
end $$;
reset role;
update public.club_member_accounts set role='member' where user_id=current_setting('v2.test_user_id')::uuid;

-- Preserve the existing V1 Google-owner policy.
select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'role','authenticated','email','harminis@gmail.com')::text,true) from public.club_member_accounts where provider='google' and role='admin' and status='approved' limit 1;
set local role authenticated;
do $$ declare n integer; begin
  insert into public.discussions(id,schedule_id,member_id,message,source) values ('__club_owner','__club_discussion_test',current_setting('v2.test_member_id'),'Owner compatibility','supabase');
  delete from public.discussions where id='__club_owner'; get diagnostics n=row_count;
  if n<>1 then raise exception 'Owner compatibility failed'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
do $$ begin
  begin
    insert into public.discussions(id,schedule_id,member_id,message,source) values ('__club_bad','__club_discussion_test',current_setting('v2.test_member_id'),'Anonymous','supabase');
    raise exception 'Anonymous insertion allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
