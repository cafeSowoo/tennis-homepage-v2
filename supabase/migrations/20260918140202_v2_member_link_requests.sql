-- Requests are preferences only; member_id/status/role remain admin controlled.
alter table public.club_member_accounts
 add column request_kind text check (request_kind in ('existing','new')),
 add column requested_member_id text references public.members(id) on delete set null,
 add column request_submitted_at timestamptz;

-- Keep the existing login bootstrap, but require the RPC for request submission.
alter policy "club members create own pending account or admins create"
on public.club_member_accounts with check (
 (auth.uid()=user_id and member_id is null and role='member' and status='pending'
  and approved_at is null and request_kind is null and requested_member_id is null
  and request_submitted_at is null)
 or club_private.club_is_admin()
);

create function club_private.v2_member_link_candidates()
returns table(id text,name text)
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.club_member_accounts a
  where a.user_id=auth.uid() and a.status='pending' and a.member_id is null) then
  raise exception 'Pending account required' using errcode='42501';
 end if;
 return query select m.id,m.name from public.members m
 where coalesce(m.status,'active')='active' order by m.name,m.id;
end $$;

create function club_private.v2_submit_member_request(p_kind text,p_member_id text,p_name text)
returns public.club_member_accounts
language plpgsql security definer set search_path='' as $$
declare a public.club_member_accounts; selected_name text;
begin
 if auth.uid() is null then raise exception 'Login required' using errcode='42501'; end if;
 select * into a from public.club_member_accounts where user_id=auth.uid() for update;
 if a.user_id is null or a.status<>'pending' or a.member_id is not null then
  raise exception 'Pending unlinked account required' using errcode='42501';
 end if;
 if p_kind is null or p_kind not in ('existing','new') then
  raise exception 'Invalid request kind' using errcode='22023';
 end if;
 if p_kind='existing' then
  select m.name into selected_name from public.members m
   where m.id=p_member_id and coalesce(m.status,'active')='active';
  if not found then raise exception 'Active member required' using errcode='22023'; end if;
 else
  selected_name:=btrim(p_name);
  if p_member_id is not null or selected_name is null or char_length(selected_name) not between 1 and 80 then
   raise exception 'New member name required (1-80 characters)' using errcode='22023';
  end if;
 end if;
 update public.club_member_accounts set request_kind=p_kind,
  requested_member_id=p_member_id,requested_name=selected_name,
  request_submitted_at=clock_timestamp(),updated_at=clock_timestamp()
 where user_id=a.user_id returning * into a;
 return a;
end $$;

create function public.v2_member_link_candidates()
returns table(id text,name text) language sql security invoker set search_path='' as $$
 select * from club_private.v2_member_link_candidates()
$$;
create function public.v2_submit_member_request(p_kind text,p_member_id text,p_name text)
returns public.club_member_accounts language sql security invoker set search_path='' as $$
 select club_private.v2_submit_member_request(p_kind,p_member_id,p_name)
$$;
revoke all on function club_private.v2_member_link_candidates(),
 club_private.v2_submit_member_request(text,text,text),public.v2_member_link_candidates(),
 public.v2_submit_member_request(text,text,text) from public,anon,authenticated;
grant execute on function club_private.v2_member_link_candidates(),
 club_private.v2_submit_member_request(text,text,text),public.v2_member_link_candidates(),
 public.v2_submit_member_request(text,text,text) to authenticated;
