-- Keep V1-imported responses distinct from a member's subsequent V2 choice.
alter table public.v2_schedule_rsvps
 add column response_source text not null default 'member' check (response_source in ('member','v1')),
 add column imported_at timestamptz,
 add constraint v2_rsvp_import_has_timestamp check (response_source<>'v1' or imported_at is not null);

create or replace function club_private.v2_rsvp(p_id uuid,p_state text)
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
 set state=excluded.state,updated_at=clock_timestamp(),updated_by_user_id=auth.uid(),response_source='member'
 returning * into r;
 return r;
end $$;

