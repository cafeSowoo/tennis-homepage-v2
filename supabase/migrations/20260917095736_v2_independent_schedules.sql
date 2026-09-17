-- Additive V2 domain. No changes to V1 tables, policies, functions or storage.
create table public.v2_schedules (
 id uuid primary key,
 creator_member_id text not null,
 created_by_user_id uuid not null,
 creator_name_snapshot text not null,
 host_member_id text,
 title text not null check (char_length(btrim(title)) between 1 and 200),
 starts_at timestamptz not null,
 ends_at timestamptz not null check (ends_at > starts_at),
 court_id text not null,
 court_unit_id text,
 court_name_snapshot text not null,
 court_unit_label_snapshot text,
 capacity integer not null default 16 check (capacity > 0),
 registration_closed boolean not null default false,
 regular boolean not null default false,
 status text not null default 'active' check (status in ('active','cancelled')),
 cancelled_at timestamptz,
 cancelled_by_user_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 updated_by_user_id uuid not null,
 version integer not null default 1 check (version > 0),
 legacy_schedule_id text unique,
 create_payload jsonb not null,
 check ((status='active' and cancelled_at is null and cancelled_by_user_id is null)
     or (status='cancelled' and cancelled_at is not null and cancelled_by_user_id is not null))
);
create index v2_schedules_starts_idx on public.v2_schedules(starts_at,id);
create index v2_schedules_creator_idx on public.v2_schedules(creator_member_id);
create table public.v2_schedule_rsvps (
 schedule_id uuid not null references public.v2_schedules(id),
 member_id text not null,
 state text not null check (state in ('attending','declined','pending')),
 updated_at timestamptz not null default clock_timestamp(),
 updated_by_user_id uuid not null,
 primary key(schedule_id,member_id)
);
create index v2_rsvps_member_idx on public.v2_schedule_rsvps(member_id,schedule_id);
create table public.v2_discussions (
 id uuid primary key,
 schedule_id uuid not null references public.v2_schedules(id),
 member_id text not null,
 created_by_user_id uuid not null,
 message text not null check (char_length(btrim(message)) between 1 and 2000),
 created_at timestamptz not null default clock_timestamp()
);
create index v2_discussions_schedule_idx on public.v2_discussions(schedule_id,created_at,id);

alter table public.v2_schedules enable row level security;
alter table public.v2_schedule_rsvps enable row level security;
alter table public.v2_discussions enable row level security;
revoke all on public.v2_schedules, public.v2_schedule_rsvps, public.v2_discussions from public,anon,authenticated;
grant select on public.v2_schedules, public.v2_schedule_rsvps, public.v2_discussions to authenticated;
grant all on public.v2_schedules, public.v2_schedule_rsvps, public.v2_discussions to service_role;
create policy "v2 approved read schedules" on public.v2_schedules for select to authenticated
 using ((select club_private.club_current_member_id()) is not null);
create policy "v2 approved read rsvps" on public.v2_schedule_rsvps for select to authenticated
 using ((select club_private.club_current_member_id()) is not null);
create policy "v2 approved read discussions" on public.v2_discussions for select to authenticated
 using ((select club_private.club_current_member_id()) is not null);

-- Private implementations are privileged because direct table writes are denied.
-- Every entry validates the caller; never accept author/member identity from clients.
create function club_private.v2_require_member() returns text
language plpgsql security definer set search_path='' as $$
declare m text;
begin
 m := club_private.club_current_member_id();
 if auth.uid() is null or m is null then
  raise exception 'Approved active member required' using errcode='42501';
 end if;
 return m;
end $$;

create function club_private.v2_schedule_write(p_id uuid,p_version integer,p_input jsonb)
returns public.v2_schedules language plpgsql security definer set search_path='' as $$
declare
 m text := club_private.v2_require_member();
 s public.v2_schedules;
 c public.courts; u public.court_units;
 v_title text; v_start timestamptz; v_end timestamptz; v_capacity integer;
 v_court text; v_unit text; v_host text; v_closed boolean; v_regular boolean;
 v_payload jsonb;
begin
 if p_id is null or p_input is null or jsonb_typeof(p_input) <> 'object' then
  raise exception 'Invalid schedule input' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_object_keys(p_input) k where k not in
   ('title','starts_at','ends_at','court_id','court_unit_id','capacity','host','registration_closed','regular')) then
  raise exception 'Unsupported schedule field' using errcode='22023';
 end if;
 -- Serializes duplicate creates before a row exists; all other writers lock the row.
 if p_version is null then perform pg_advisory_xact_lock(hashtextextended(p_id::text,0)); end if;
 select * into s from public.v2_schedules where id=p_id for update;
 if p_version is not null then
  if s.id is null then raise exception 'Schedule not found' using errcode='P0002'; end if;
  if s.creator_member_id<>m and not club_private.club_is_admin() then
   raise exception 'Only creator or admin may edit' using errcode='42501';
  end if;
  if s.version<>p_version then raise exception 'Schedule changed; reload before editing' using errcode='40001'; end if;
  if s.status='cancelled' or s.starts_at<=clock_timestamp() then
   raise exception 'Schedule cannot be edited' using errcode='42501';
  end if;
 end if;
 v_title := btrim(p_input->>'title');
 v_start := (p_input->>'starts_at')::timestamptz;
 v_end := (p_input->>'ends_at')::timestamptz;
 v_capacity := coalesce((p_input->>'capacity')::integer,16);
 v_court := p_input->>'court_id'; v_unit := nullif(p_input->>'court_unit_id','');
 v_closed := coalesce((p_input->>'registration_closed')::boolean,false);
 v_regular := coalesce((p_input->>'regular')::boolean,false);
 -- Preserve the designated host on administrator edits unless the flag is changed.
 v_host := case when coalesce((p_input->>'host')::boolean,false) then coalesce(s.host_member_id,m) else null end;
 v_payload := jsonb_build_object('title',v_title,'starts_at',v_start,'ends_at',v_end,
  'capacity',v_capacity,'court_id',v_court,'court_unit_id',v_unit,
  'host',coalesce((p_input->>'host')::boolean,false),'registration_closed',v_closed,'regular',v_regular);
 if p_version is null and s.id is not null then
  if s.creator_member_id=m and s.create_payload=v_payload then return s; end if;
  raise exception 'Schedule request ID conflict' using errcode='23505';
 end if;
 if v_title is null or char_length(v_title) not between 1 and 200
    or v_start is null or v_end is null or not isfinite(v_start) or not isfinite(v_end)
    or v_start<=clock_timestamp() or v_end<=v_start or v_capacity<1 then
  raise exception 'Invalid title, time or capacity' using errcode='22023';
 end if;
 select * into c from public.courts where id=v_court;
 if c.id is null then raise exception 'Unknown court' using errcode='22023'; end if;
 if v_unit is not null then
  select * into u from public.court_units where id=v_unit and court_id=v_court;
  if u.id is null then raise exception 'Court unit does not belong to court' using errcode='22023'; end if;
 end if;
 if p_version is null then
  insert into public.v2_schedules(id,creator_member_id,created_by_user_id,creator_name_snapshot,
   host_member_id,title,starts_at,ends_at,court_id,court_unit_id,court_name_snapshot,court_unit_label_snapshot,
   capacity,registration_closed,regular,updated_by_user_id,create_payload)
  values(p_id,m,auth.uid(),(select name from public.members where id=m),v_host,v_title,v_start,v_end,
   v_court,v_unit,c.name,u.label,v_capacity,v_closed,v_regular,auth.uid(),v_payload)
  returning * into s;
 else
  if v_capacity < (select count(*) from public.v2_schedule_rsvps where schedule_id=p_id and state='attending') then
   raise exception 'Capacity below current attendance' using errcode='22023';
  end if;
  update public.v2_schedules set title=v_title,starts_at=v_start,ends_at=v_end,court_id=v_court,
   court_unit_id=v_unit,court_name_snapshot=c.name,court_unit_label_snapshot=u.label,
   host_member_id=v_host,capacity=v_capacity,registration_closed=v_closed,regular=v_regular,
   updated_at=clock_timestamp(),updated_by_user_id=auth.uid(),version=version+1
  where id=p_id returning * into s;
 end if;
 return s;
end $$;

create function club_private.v2_cancel(p_id uuid,p_version integer)
returns public.v2_schedules language plpgsql security definer set search_path='' as $$
declare m text:=club_private.v2_require_member(); s public.v2_schedules;
begin
 select * into s from public.v2_schedules where id=p_id for update;
 if s.id is null then raise exception 'Schedule not found' using errcode='P0002'; end if;
 if s.creator_member_id<>m and not club_private.club_is_admin() then
  raise exception 'Only creator or admin may cancel' using errcode='42501';
 end if;
 if s.status='cancelled' then return s; end if;
 if p_version is null or s.version<>p_version then raise exception 'Schedule changed; reload before cancelling' using errcode='40001'; end if;
 update public.v2_schedules set status='cancelled',cancelled_at=clock_timestamp(),cancelled_by_user_id=auth.uid(),
  updated_at=clock_timestamp(),updated_by_user_id=auth.uid(),version=version+1
 where id=p_id returning * into s;
 return s;
end $$;

create function club_private.v2_rsvp(p_id uuid,p_state text)
returns public.v2_schedule_rsvps language plpgsql security definer set search_path='' as $$
declare m text:=club_private.v2_require_member(); s public.v2_schedules; r public.v2_schedule_rsvps;
begin
 if p_state is null or p_state not in ('attending','declined','pending') then
  raise exception 'Invalid RSVP state' using errcode='22023';
 end if;
 select * into s from public.v2_schedules where id=p_id for update;
 if s.id is null then raise exception 'Schedule not found' using errcode='P0002'; end if;
 if s.status='cancelled' or s.starts_at<=clock_timestamp() then
  raise exception 'RSVP is closed for this schedule' using errcode='42501';
 end if;
 select * into r from public.v2_schedule_rsvps where schedule_id=p_id and member_id=m;
 if p_state='attending' and (r.state is distinct from 'attending') then
  if s.registration_closed then raise exception 'Registration closed' using errcode='42501'; end if;
  if (select count(*) from public.v2_schedule_rsvps where schedule_id=p_id and state='attending')>=s.capacity then
   raise exception 'Schedule capacity reached' using errcode='22023';
  end if;
 end if;
 insert into public.v2_schedule_rsvps(schedule_id,member_id,state,updated_by_user_id)
 values(p_id,m,p_state,auth.uid()) on conflict(schedule_id,member_id) do update
 set state=excluded.state,updated_at=clock_timestamp(),updated_by_user_id=auth.uid()
 returning * into r;
 return r;
end $$;

create function club_private.v2_comment_add(p_id uuid,p_schedule_id uuid,p_message text)
returns public.v2_discussions language plpgsql security definer set search_path='' as $$
declare m text:=club_private.v2_require_member(); s public.v2_schedules; d public.v2_discussions;
begin
 if p_id is null or p_message is null or char_length(btrim(p_message)) not between 1 and 2000 then
  raise exception 'Comment must contain 1 to 2000 characters' using errcode='22023';
 end if;
 select * into s from public.v2_schedules where id=p_schedule_id for update;
 if s.id is null then raise exception 'Schedule not found' using errcode='P0002'; end if;
 -- Return an already committed request even if the schedule was subsequently cancelled.
 select * into d from public.v2_discussions where id=p_id;
 if d.id is not null then
  if d.member_id=m and d.schedule_id=p_schedule_id and d.message=btrim(p_message) then return d; end if;
  raise exception 'Comment request ID conflict' using errcode='23505';
 end if;
 if s.status='cancelled' then raise exception 'Schedule cancelled' using errcode='42501'; end if;
 insert into public.v2_discussions(id,schedule_id,member_id,created_by_user_id,message)
 values(p_id,p_schedule_id,m,auth.uid(),btrim(p_message)) returning * into d;
 return d;
end $$;

create function club_private.v2_comment_delete(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare m text:=club_private.v2_require_member(); sid uuid;
begin
 select schedule_id into sid from public.v2_discussions where id=p_id;
 if sid is null then return false; end if;
 perform 1 from public.v2_schedules where id=sid for update;
 delete from public.v2_discussions where id=p_id and
  (member_id=m or club_private.club_is_admin());
 return found;
end $$;

create function public.v2_create_schedule(p_id uuid,p_input jsonb) returns public.v2_schedules
language sql security invoker set search_path='' as $$ select club_private.v2_schedule_write(p_id,null,p_input) $$;
revoke all on function public.v2_create_schedule(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.v2_create_schedule(uuid,jsonb) to authenticated;

create function public.v2_update_schedule(p_id uuid,p_version integer,p_input jsonb) returns public.v2_schedules
language sql security invoker set search_path='' as $$ select club_private.v2_schedule_write(p_id,p_version,p_input) $$;
revoke all on function public.v2_update_schedule(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.v2_update_schedule(uuid,integer,jsonb) to authenticated;

create function public.v2_cancel_schedule(p_id uuid,p_version integer) returns public.v2_schedules
language sql security invoker set search_path='' as $$ select club_private.v2_cancel(p_id,p_version) $$;
revoke all on function public.v2_cancel_schedule(uuid,integer) from public,anon,authenticated;
grant execute on function public.v2_cancel_schedule(uuid,integer) to authenticated;

create function public.v2_set_my_rsvp(p_id uuid,p_state text) returns public.v2_schedule_rsvps
language sql security invoker set search_path='' as $$ select club_private.v2_rsvp(p_id,p_state) $$;
revoke all on function public.v2_set_my_rsvp(uuid,text) from public,anon,authenticated;
grant execute on function public.v2_set_my_rsvp(uuid,text) to authenticated;

create function public.v2_add_discussion(p_id uuid,p_schedule_id uuid,p_message text) returns public.v2_discussions
language sql security invoker set search_path='' as $$ select club_private.v2_comment_add(p_id,p_schedule_id,p_message) $$;
revoke all on function public.v2_add_discussion(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.v2_add_discussion(uuid,uuid,text) to authenticated;

create function public.v2_delete_discussion(p_id uuid) returns boolean
language sql security invoker set search_path='' as $$ select club_private.v2_comment_delete(p_id) $$;
revoke all on function public.v2_delete_discussion(uuid) from public,anon,authenticated;
grant execute on function public.v2_delete_discussion(uuid) to authenticated;
revoke all on function club_private.v2_require_member() from public,anon,authenticated;
grant execute on function club_private.v2_require_member() to authenticated;
revoke all on function club_private.v2_schedule_write(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function club_private.v2_schedule_write(uuid,integer,jsonb) to authenticated;
revoke all on function club_private.v2_cancel(uuid,integer) from public,anon,authenticated;
grant execute on function club_private.v2_cancel(uuid,integer) to authenticated;
revoke all on function club_private.v2_rsvp(uuid,text) from public,anon,authenticated;
grant execute on function club_private.v2_rsvp(uuid,text) to authenticated;
revoke all on function club_private.v2_comment_add(uuid,uuid,text) from public,anon,authenticated;
grant execute on function club_private.v2_comment_add(uuid,uuid,text) to authenticated;
revoke all on function club_private.v2_comment_delete(uuid) from public,anon,authenticated;
grant execute on function club_private.v2_comment_delete(uuid) to authenticated;
