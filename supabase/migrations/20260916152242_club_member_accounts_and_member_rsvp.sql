create schema if not exists club_private;
revoke all on schema club_private from public, anon, authenticated;
grant usage on schema club_private to authenticated, service_role;

create table public.club_member_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  member_id text references public.members(id) on delete set null,
  requested_name text,
  provider text,
  role text not null default 'member',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  constraint club_member_accounts_role_check check (role in ('member','admin')),
  constraint club_member_accounts_status_check check (status in ('pending','approved','disabled'))
);

create index club_member_accounts_member_id_idx on public.club_member_accounts(member_id);

alter table public.club_member_accounts enable row level security;
revoke all on table public.club_member_accounts from public, anon, authenticated;
grant select, insert, update, delete on table public.club_member_accounts to authenticated, service_role;

create function club_private.club_current_member_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.member_id
  from public.club_member_accounts a
  join public.members m on m.id = a.member_id
  where a.user_id = auth.uid()
    and a.status = 'approved'
    and a.member_id is not null
    and coalesce(m.status, 'active') = 'active'
  limit 1
$$;

create function club_private.club_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.club_member_accounts a
    join public.members m on m.id = a.member_id
    where a.user_id = auth.uid()
      and a.status = 'approved'
      and a.role = 'admin'
      and coalesce(m.status, 'active') = 'active'
  )
$$;

revoke all on function club_private.club_current_member_id() from public, anon, authenticated;
revoke all on function club_private.club_is_admin() from public, anon, authenticated;
grant execute on function club_private.club_current_member_id() to authenticated, service_role;
grant execute on function club_private.club_is_admin() to authenticated, service_role;

create policy "club members read own account or admins read all"
on public.club_member_accounts
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or (select club_private.club_is_admin())
);

create policy "club members create own pending account or admins create"
on public.club_member_accounts
for insert
to authenticated
with check (
  (
    (select auth.uid()) = user_id
    and member_id is null
    and role = 'member'
    and status = 'pending'
    and approved_at is null
  )
  or (select club_private.club_is_admin())
);

create policy "club admins update accounts"
on public.club_member_accounts
for update
to authenticated
using ((select club_private.club_is_admin()))
with check ((select club_private.club_is_admin()));

create policy "club admins delete accounts"
on public.club_member_accounts
for delete
to authenticated
using ((select club_private.club_is_admin()));

insert into public.club_member_accounts (
  user_id,
  member_id,
  requested_name,
  provider,
  role,
  status,
  approved_at
)
select
  u.id,
  'member-kim-jiseok',
  '김지석',
  coalesce(u.raw_app_meta_data ->> 'provider', 'google'),
  'admin',
  'approved',
  now()
from auth.users u
where lower(u.email) = 'harminis@gmail.com'
on conflict (user_id) do update
set member_id = excluded.member_id,
    requested_name = excluded.requested_name,
    provider = excluded.provider,
    role = 'admin',
    status = 'approved',
    updated_at = now(),
    approved_at = coalesce(public.club_member_accounts.approved_at, excluded.approved_at);

create function club_private.set_my_schedule_rsvp_internal(p_schedule_id text, p_state text)
returns public.schedules
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_member_id text;
  v_schedule public.schedules;
begin
  if v_user_id is null then
    raise exception 'Login required' using errcode = '42501';
  end if;

  if p_state is null or p_state not in ('attending', 'declined', 'pending') then
    raise exception 'RSVP state must be attending, declined, or pending' using errcode = '22023';
  end if;

  select a.member_id
    into v_member_id
  from public.club_member_accounts a
  join public.members m on m.id = a.member_id
  where a.user_id = v_user_id
    and a.status = 'approved'
    and a.member_id is not null
    and coalesce(m.status, 'active') = 'active'
  limit 1;

  if v_member_id is null then
    raise exception 'Approved club member required' using errcode = '42501';
  end if;

  select *
    into v_schedule
  from public.schedules
  where id = p_schedule_id
  for update;

  if not found then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;

  if p_state = 'attending' and not (v_member_id = any(v_schedule.attendee_ids)) then
    if coalesce(v_schedule.closed, false) then
      raise exception 'Schedule is closed' using errcode = '42501';
    end if;
    if cardinality(v_schedule.attendee_ids) >= 16 then
      raise exception 'Schedule capacity reached' using errcode = '42501';
    end if;
  end if;

  insert into public.schedule_rsvp_overrides(schedule_id, member_id, state)
  values (p_schedule_id, v_member_id, p_state)
  on conflict (schedule_id, member_id) do update
  set state = excluded.state;

  if v_schedule.source = 'kakao' then
    update public.schedules
    set kakao_attendee_ids = kakao_attendee_ids
    where id = p_schedule_id
    returning * into v_schedule;
    return v_schedule;
  end if;

  if p_state = 'attending' then
    delete from public.schedule_declines
    where schedule_id = p_schedule_id and member_id = v_member_id;

    update public.schedules
    set attendee_ids = case
          when v_member_id = any(attendee_ids) then attendee_ids
          else array_append(attendee_ids, v_member_id)
        end,
        absentee_ids = array_remove(absentee_ids, v_member_id)
    where id = p_schedule_id
    returning * into v_schedule;
  elsif p_state = 'declined' then
    insert into public.schedule_declines(schedule_id, member_id, created_at)
    values (p_schedule_id, v_member_id, now())
    on conflict (schedule_id, member_id) do update
    set created_at = excluded.created_at;

    update public.schedules
    set attendee_ids = array_remove(attendee_ids, v_member_id),
        absentee_ids = case
          when v_member_id = any(absentee_ids) then absentee_ids
          else array_append(absentee_ids, v_member_id)
        end
    where id = p_schedule_id
    returning * into v_schedule;
  else
    delete from public.schedule_declines
    where schedule_id = p_schedule_id and member_id = v_member_id;

    update public.schedules
    set attendee_ids = array_remove(attendee_ids, v_member_id),
        absentee_ids = array_remove(absentee_ids, v_member_id)
    where id = p_schedule_id
    returning * into v_schedule;
  end if;

  return v_schedule;
end
$$;

revoke all on function club_private.set_my_schedule_rsvp_internal(text, text) from public, anon, authenticated;
grant execute on function club_private.set_my_schedule_rsvp_internal(text, text) to authenticated, service_role;

create function public.set_my_schedule_rsvp(p_schedule_id text, p_state text)
returns public.schedules
language sql
security invoker
set search_path = ''
as $$
  select club_private.set_my_schedule_rsvp_internal(p_schedule_id, p_state)
$$;

revoke all on function public.set_my_schedule_rsvp(text, text) from public, anon, authenticated;
grant execute on function public.set_my_schedule_rsvp(text, text) to authenticated, service_role;
