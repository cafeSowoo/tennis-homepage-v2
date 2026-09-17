-- V2-only follow-up guards: tabs/newlines are not meaningful content.
alter table public.v2_schedules add constraint v2_schedule_nonblank_title check (title ~ '[^[:space:]]');
alter table public.v2_discussions add constraint v2_discussion_nonblank_message check (message ~ '[^[:space:]]');
create or replace function public.v2_update_schedule(p_id uuid,p_version integer,p_input jsonb)
returns public.v2_schedules language plpgsql security invoker set search_path='' as $$
begin
 if p_version is null or p_version<1 then
  raise exception 'Expected schedule version required' using errcode='22023';
 end if;
 return club_private.v2_schedule_write(p_id,p_version,p_input);
end $$;
revoke all on function public.v2_update_schedule(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.v2_update_schedule(uuid,integer,jsonb) to authenticated;
