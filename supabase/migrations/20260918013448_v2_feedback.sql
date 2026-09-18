-- V2 pilot feedback only. No changes to V1 or shared membership policies.
create table public.v2_feedback (
 id uuid primary key,
 author_user_id uuid not null,
 member_id text not null,
 author_name text not null,
 category text not null check(category in ('error','inconvenience','suggestion')),
 body text not null check(length(btrim(body)) between 1 and 4000),
 view_name text not null check(view_name in ('dashboard','schedule','detail','members','member-detail','other')),
 schedule_id uuid references public.v2_schedules(id) on delete set null,
 client_version text not null check(client_version ~ '^([a-f0-9]{7,40}|development)$'),
 status text not null default 'new' check(status in ('new','in_progress','resolved')),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 updated_by_user_id uuid,
 version integer not null default 1 check(version>0)
);
create index v2_feedback_author_created on public.v2_feedback(author_user_id,created_at desc,id);
create index v2_feedback_created on public.v2_feedback(created_at desc,id);
create index v2_feedback_schedule on public.v2_feedback(schedule_id);
alter table public.v2_feedback enable row level security;
revoke all on public.v2_feedback from public,anon,authenticated;
grant select on public.v2_feedback to authenticated;
create policy v2_feedback_read on public.v2_feedback for select to authenticated using (
 (select club_private.club_current_member_id()) is not null and
 (author_user_id=(select auth.uid()) or (select club_private.club_is_admin()))
);
create function club_private.v2_submit_feedback(p_id uuid,p_category text,p_body text,p_view text,p_schedule_id uuid,p_client_version text)
returns public.v2_feedback language plpgsql security definer set search_path='' as $$
declare m text; r public.v2_feedback;
begin
 m:=club_private.v2_require_member();
 if p_id is null or p_category is null or p_category not in ('error','inconvenience','suggestion')
 or p_body is null or length(btrim(p_body)) not between 1 and 4000
 or p_view is null or p_view not in ('dashboard','schedule','detail','members','member-detail','other')
 or p_client_version is null or p_client_version !~ '^([a-f0-9]{7,40}|development)$' then
 raise exception 'Invalid feedback' using errcode='22023'; end if;
 -- A stable client id makes retries safe, without allowing ownership or content changes.
 perform pg_advisory_xact_lock(hashtextextended('v2_feedback:'||p_id::text,0));
 select * into r from public.v2_feedback where id=p_id;
 if found then
  if r.author_user_id<>auth.uid() then raise exception 'Feedback unavailable' using errcode='42501'; end if;
  if (r.category,r.body,r.view_name,r.schedule_id,r.client_version) is distinct from
     (p_category,btrim(p_body),p_view,p_schedule_id,p_client_version) then
   raise exception 'Request id already used' using errcode='23505'; end if;
  return r;
 end if;
 if p_schedule_id is not null and not exists(select 1 from public.v2_schedules where id=p_schedule_id) then
  raise exception 'Invalid schedule' using errcode='22023'; end if;
 insert into public.v2_feedback(id,author_user_id,member_id,author_name,category,body,view_name,schedule_id,client_version)
 values(p_id,auth.uid(),m,(select name from public.members where id=m),p_category,btrim(p_body),p_view,p_schedule_id,p_client_version)
 returning * into r;
 return r;
end $$;
create function club_private.v2_set_feedback_status(p_id uuid,p_status text,p_version integer)
returns public.v2_feedback language plpgsql security definer set search_path='' as $$
declare r public.v2_feedback;
begin
 if auth.uid() is null or not club_private.club_is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
 if p_status is null or p_status not in ('new','in_progress','resolved') then raise exception 'Invalid status' using errcode='22023'; end if;
 select * into r from public.v2_feedback where id=p_id for update;
 if not found then raise exception 'Feedback unavailable' using errcode='P0002'; end if;
 if p_version is null or p_version<>r.version then raise exception 'Refresh first' using errcode='40001'; end if;
 update public.v2_feedback set status=p_status,version=version+1,updated_at=clock_timestamp(),updated_by_user_id=auth.uid()
 where id=p_id returning * into r;
 return r;
end $$;
create function public.v2_submit_feedback(p_id uuid,p_category text,p_body text,p_view text,p_schedule_id uuid,p_client_version text)
returns public.v2_feedback language sql security invoker set search_path='' as $$
 select club_private.v2_submit_feedback(p_id,p_category,p_body,p_view,p_schedule_id,p_client_version)
$$;
create function public.v2_set_feedback_status(p_id uuid,p_status text,p_version integer)
returns public.v2_feedback language sql security invoker set search_path='' as $$
 select club_private.v2_set_feedback_status(p_id,p_status,p_version)
$$;
revoke all on function club_private.v2_submit_feedback(uuid,text,text,text,uuid,text),public.v2_submit_feedback(uuid,text,text,text,uuid,text),
 club_private.v2_set_feedback_status(uuid,text,integer),public.v2_set_feedback_status(uuid,text,integer) from public,anon,authenticated;
grant execute on function club_private.v2_submit_feedback(uuid,text,text,text,uuid,text),public.v2_submit_feedback(uuid,text,text,text,uuid,text),
 club_private.v2_set_feedback_status(uuid,text,integer),public.v2_set_feedback_status(uuid,text,integer) to authenticated;
