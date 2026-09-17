-- Additive V2 admin API. Existing tables, policies and Google admin accounts are retained.
create function club_private.v2_admin_list_accounts(p_offset integer)
returns setof public.club_member_accounts
language plpgsql security definer set search_path='' as $$
begin
 if not club_private.club_is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 then raise exception 'Invalid offset' using errcode='22023'; end if;
 return query select a.* from public.club_member_accounts a join auth.users u on u.id=a.user_id
 where u.raw_app_meta_data->>'provider'='kakao'
 order by a.created_at,a.user_id limit 200 offset p_offset;
end $$;

create function club_private.v2_admin_manage_account(p_user_id uuid,p_member_id text,p_status text,p_expected_updated_at timestamptz)
returns public.club_member_accounts
language plpgsql security definer set search_path='' as $$
declare a public.club_member_accounts;
begin
 if not club_private.club_is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if p_status is null or p_status not in ('approved','disabled') then raise exception 'Invalid status' using errcode='22023'; end if;
 select * into a from public.club_member_accounts where user_id=p_user_id for update;
 if a.user_id is null then raise exception 'Account not found' using errcode='P0002'; end if;
 if a.user_id=auth.uid() or a.role='admin' or not exists (
  select 1 from auth.users u where u.id=a.user_id and u.raw_app_meta_data->>'provider'='kakao'
 ) then raise exception 'Protected account' using errcode='42501'; end if;
 if p_expected_updated_at is null or a.updated_at<>p_expected_updated_at then
  raise exception 'Account changed; refresh first' using errcode='40001';
 end if;
 if p_status='approved' then
  if p_member_id is null or not exists(select 1 from public.members m where m.id=p_member_id and coalesce(m.status,'active')='active') then
   raise exception 'Active member required' using errcode='22023';
  end if;
  if a.member_id is not null and a.member_id<>p_member_id then
   raise exception 'Existing member link cannot be reassigned' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('v2_member_link:'||p_member_id,0));
  if exists(select 1 from public.club_member_accounts x join auth.users u on u.id=x.user_id
   where x.user_id<>a.user_id and x.member_id=p_member_id and x.status='approved'
   and u.raw_app_meta_data->>'provider'='kakao') then
   raise exception 'Member already has an approved Kakao account' using errcode='23505';
  end if;
 elsif p_member_id is distinct from a.member_id then
  raise exception 'Disabling must preserve member link' using errcode='22023';
 end if;
 update public.club_member_accounts set member_id=case when p_status='approved' then p_member_id else a.member_id end,
 status=p_status,approved_at=case when p_status='approved' then coalesce(a.approved_at,clock_timestamp()) else a.approved_at end,
 updated_at=clock_timestamp() where user_id=a.user_id returning * into a;
 return a;
end $$;

create function public.v2_admin_list_accounts(p_offset integer default 0)
returns setof public.club_member_accounts language sql security invoker set search_path='' as $$
 select * from club_private.v2_admin_list_accounts(p_offset)
$$;
create function public.v2_admin_manage_account(p_user_id uuid,p_member_id text,p_status text,p_expected_updated_at timestamptz)
returns public.club_member_accounts language sql security invoker set search_path='' as $$
 select club_private.v2_admin_manage_account(p_user_id,p_member_id,p_status,p_expected_updated_at)
$$;
revoke all on function club_private.v2_admin_list_accounts(integer),club_private.v2_admin_manage_account(uuid,text,text,timestamptz),
 public.v2_admin_list_accounts(integer),public.v2_admin_manage_account(uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function club_private.v2_admin_list_accounts(integer),club_private.v2_admin_manage_account(uuid,text,text,timestamptz),
 public.v2_admin_list_accounts(integer),public.v2_admin_manage_account(uuid,text,text,timestamptz) to authenticated;
