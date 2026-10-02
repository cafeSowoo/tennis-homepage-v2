alter table public.schedules add column kakao_attendee_ids text[];
alter table public.schedules add column kakao_absentee_ids text[];
alter table public.schedules add column absentee_ids text[] not null default '{}';
create table public.schedule_rsvp_overrides (
  schedule_id text not null references public.schedules(id) on delete cascade,
  member_id text not null references public.members(id) on delete cascade,
  state text not null check(state in ('attending','declined','pending')),
  primary key(schedule_id,member_id)
);
alter table public.schedule_rsvp_overrides enable row level security;
revoke all on public.schedule_rsvp_overrides from anon,authenticated;
grant select on public.schedule_rsvp_overrides to anon,authenticated;
grant insert,update,delete on public.schedule_rsvp_overrides to authenticated;
create policy "public reads rsvp overrides" on public.schedule_rsvp_overrides for select using(true);
create policy "owner manages rsvp overrides" on public.schedule_rsvp_overrides for all to authenticated
using(lower((select auth.jwt()->>'email'))='harminis@gmail.com')
with check(lower((select auth.jwt()->>'email'))='harminis@gmail.com');
insert into public.schedule_rsvp_overrides select d.schedule_id,d.member_id,'declined'
from public.schedule_declines d join public.schedules s on s.id=d.schedule_id where s.source='kakao';

create function public.resolve_schedule_rsvp() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.source='kakao' and new.kakao_attendee_ids is not null then
    -- Existing homepage editors write attendee_ids. Convert only their delta
    -- into explicit choices; source importers write the kakao_* columns.
    if tg_op='UPDATE' and new.kakao_attendee_ids is not distinct from old.kakao_attendee_ids
       and new.kakao_absentee_ids is not distinct from old.kakao_absentee_ids
       and new.attendee_ids is distinct from old.attendee_ids then
      insert into public.schedule_rsvp_overrides(schedule_id,member_id,state)
      select new.id,id,case when id=any(new.attendee_ids) then 'attending' else 'pending' end
      from ((select unnest(new.attendee_ids) id except select unnest(old.attendee_ids))
            union (select unnest(old.attendee_ids) except select unnest(new.attendee_ids))) changed
      on conflict(schedule_id,member_id) do update set state=excluded.state;
    end if;
    select coalesce(array_agg(distinct member_id order by member_id),'{}') into new.attendee_ids from (
      select unnest(new.kakao_attendee_ids) member_id
      except select o.member_id from public.schedule_rsvp_overrides o where o.schedule_id=new.id
      union select o.member_id from public.schedule_rsvp_overrides o where o.schedule_id=new.id and state='attending'
    ) a;
    select coalesce(array_agg(distinct member_id order by member_id),'{}') into new.absentee_ids from (
      select unnest(coalesce(new.kakao_absentee_ids,'{}')) member_id
      except select o.member_id from public.schedule_rsvp_overrides o where o.schedule_id=new.id
      union select o.member_id from public.schedule_rsvp_overrides o where o.schedule_id=new.id and state='declined'
    ) a;
  end if;
  return new;
end $$;
create trigger resolve_schedule_rsvp before insert or update on public.schedules for each row execute function public.resolve_schedule_rsvp();
update public.schedules set kakao_attendee_ids=attendee_ids where source='kakao';

create function public.set_schedule_rsvp(p_schedule_id text,p_member_id text,p_state text)
returns public.schedules language plpgsql security invoker set search_path='' as $$
declare result public.schedules;
begin
  if lower(coalesce((select auth.jwt()->>'email'),'')) <> 'harminis@gmail.com' then
    raise exception 'Owner login required' using errcode='42501';
  end if;
  select * into result from public.schedules where id=p_schedule_id and source='kakao' for update;
  if not found then raise exception 'Kakao schedule not found'; end if;
  if p_state is null then
    delete from public.schedule_rsvp_overrides where schedule_id=p_schedule_id and member_id=p_member_id;
  else
    insert into public.schedule_rsvp_overrides(schedule_id,member_id,state) values(p_schedule_id,p_member_id,p_state)
    on conflict(schedule_id,member_id) do update set state=excluded.state;
  end if;
  update public.schedules set kakao_attendee_ids=kakao_attendee_ids where id=p_schedule_id returning * into result;
  return result;
end $$;
revoke all on function public.resolve_schedule_rsvp() from public,anon,authenticated;
revoke all on function public.set_schedule_rsvp(text,text,text) from public,anon;
grant execute on function public.set_schedule_rsvp(text,text,text) to authenticated;
