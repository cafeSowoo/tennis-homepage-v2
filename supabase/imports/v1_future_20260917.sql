-- One-time, snapshot-guarded import. Caller must wrap the whole script in a transaction.
-- This script never writes to V1. Re-running does not overwrite any V2 row.
create temporary table v1_import_source on commit drop as
 select * from public.schedules where date>=date '2026-09-17';
do $$
begin
 if (select md5(coalesce(jsonb_agg(to_jsonb(s) order by id),'[]'::jsonb)::text) from v1_import_source s)<>'99185c77e86ab71ece02fbd409df0bb1' then
  raise exception 'V1 source changed; review and back up a new snapshot before importing';
 end if;
 if exists(select 1 from public.discussions d join v1_import_source s on s.id=d.schedule_id)
 or exists(select 1 from public.schedule_declines d join v1_import_source s on s.id=d.schedule_id)
 or exists(select 1 from public.schedule_rsvp_overrides d join v1_import_source s on s.id=d.schedule_id) then
  raise exception 'New comments or RSVP overrides require explicit reconciliation';
 end if;
 if not exists(select 1 from public.club_member_accounts where user_id='754b454d-0793-477b-96c6-300dbce34b4c' and member_id='member-kim-jiseok' and status='approved' and role='admin') then
  raise exception 'Import administrator is not approved';
 end if;
 if exists(select 1 from v1_import_source s left join public.courts c on c.id=s.court_id where c.id is null)
 or exists(select 1 from v1_import_source s left join public.court_units u on u.id=s.court_unit_id and u.court_id=s.court_id where s.court_unit_id is not null and u.id is null) then
  raise exception 'Invalid court reference';
 end if;
 if exists(select 1 from v1_import_source s where s.attendee_ids && s.absentee_ids) then raise exception 'Conflicting RSVP states'; end if;
 if exists(select 1 from (select unnest(coalesce(attendee_ids,'{}')||coalesce(absentee_ids,'{}')) id from v1_import_source) x left join public.members m on m.id=x.id where m.id is null) then raise exception 'Unknown member'; end if;
end $$;
create or replace function pg_temp.v1_clock(value text) returns interval language plpgsql immutable as $$
declare p text[]; h integer; m integer;
begin
 p:=regexp_match(btrim(value),'^(오전|오후) ([0-9]{1,2}):([0-9]{2})$');
 if p is null then raise exception 'Unrecognized time: %',value; end if;
 h:=p[2]::integer; m:=p[3]::integer;
 if h not between 1 and 12 or m not between 0 and 59 then raise exception 'Invalid time'; end if;
 return make_interval(hours=>h%12+case when p[1]='오후' then 12 else 0 end,mins=>m);
end $$;
create temporary table v1_import_inserted on commit drop as
 with input as (
  select s.*,pg_temp.v1_clock(split_part(s.time,'~',1)) start_time,pg_temp.v1_clock(split_part(s.time,'~',2)) end_time from v1_import_source s
 ), inserted as (
 insert into public.v2_schedules(id,creator_member_id,created_by_user_id,creator_name_snapshot,host_member_id,title,
 starts_at,ends_at,court_id,court_unit_id,court_name_snapshot,court_unit_label_snapshot,capacity,registration_closed,regular,
 updated_by_user_id,legacy_schedule_id,create_payload)
 select gen_random_uuid(),'member-kim-jiseok','754b454d-0793-477b-96c6-300dbce34b4c','김지석',s.host_id,s.title,
 (s.date+s.start_time) at time zone 'Asia/Seoul',
 (s.date+s.end_time+case when s.end_time<=s.start_time then interval '1 day' else interval '0' end) at time zone 'Asia/Seoul',
 s.court_id,s.court_unit_id,c.name,u.label,greatest(16,coalesce(cardinality(s.attendee_ids),0)),coalesce(s.closed,false),coalesce(s.regular,false),
 '754b454d-0793-477b-96c6-300dbce34b4c',s.id,
 jsonb_build_object('import_batch','v1-future-20260917','imported_at',transaction_timestamp(),'v1_snapshot',to_jsonb(original))
 from input s join v1_import_source original on original.id=s.id join public.courts c on c.id=s.court_id left join public.court_units u on u.id=s.court_unit_id
 on conflict (legacy_schedule_id) do nothing returning id,legacy_schedule_id
 ) select * from inserted;
insert into public.v2_schedule_rsvps(schedule_id,member_id,state,updated_by_user_id,response_source,imported_at)
 select i.id,r.member_id,r.state,'754b454d-0793-477b-96c6-300dbce34b4c','v1',transaction_timestamp()
 from v1_import_inserted i join v1_import_source s on s.id=i.legacy_schedule_id
 cross join lateral (
  select unnest(s.attendee_ids) member_id,'attending' state union
  select unnest(s.absentee_ids) member_id,'declined' state
 ) r;
-- Verify every source is mapped. Verify new rows only, preserving later V2 edits on a rerun.
do $$
begin
 if (select count(*) from public.v2_schedules v join v1_import_source s on v.legacy_schedule_id=s.id)<>20 then raise exception 'Missing schedule mappings'; end if;
 if (select count(*) from public.v2_schedule_rsvps r join v1_import_inserted i on i.id=r.schedule_id)<>
 (select coalesce(sum(cardinality(s.attendee_ids)+cardinality(s.absentee_ids)),0) from v1_import_source s join v1_import_inserted i on i.legacy_schedule_id=s.id) then raise exception 'RSVP count mismatch'; end if;
end $$;
select (select count(*) from v1_import_inserted) inserted_schedules,
 (select count(*) from public.v2_schedule_rsvps r join v1_import_inserted i on i.id=r.schedule_id where r.state='attending') inserted_attending,
 (select count(*) from public.v2_schedule_rsvps r join v1_import_inserted i on i.id=r.schedule_id where r.state='declined') inserted_declined;
