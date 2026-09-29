-- A sync may record its check time while some schedules await review
-- (e.g. an unknown court). held_count says how many, so the page can show
-- "확인 필요 N건" instead of looking stalled. The old three-argument function
-- is replaced (not overloaded) so existing callers keep working through the
-- default and PostgREST sees a single candidate.
alter table public.kakao_sync_state
  add column held_count integer not null default 0 check (held_count >= 0);

drop function public.record_kakao_sync(timestamptz, integer, text);
create function public.record_kakao_sync(
  p_collected_at timestamptz, p_schedule_count integer, p_fingerprint text, p_held_count integer default 0)
returns public.kakao_sync_state language plpgsql security invoker set search_path = '' as $$
declare recorded public.kakao_sync_state;
begin
  if lower(coalesce((select auth.jwt() ->> 'email'), '')) <> 'harminis@gmail.com' then
    raise exception 'Owner login required' using errcode = '42501';
  end if;
  if coalesce(p_held_count, 0) < 0 then
    raise exception 'held count must not be negative' using errcode = '22023';
  end if;
  select * into recorded from public.kakao_sync_state where id = 'kakao';
  if recorded.last_collected_at = p_collected_at and recorded.batch_fingerprint = p_fingerprint then
    return recorded;
  end if;
  insert into public.kakao_sync_state(id, last_collected_at, schedule_count, batch_fingerprint, held_count)
    values ('kakao', p_collected_at, p_schedule_count, p_fingerprint, coalesce(p_held_count, 0))
  on conflict(id) do update set
    last_collected_at = excluded.last_collected_at, completed_at = now(),
    schedule_count = excluded.schedule_count, batch_fingerprint = excluded.batch_fingerprint,
    held_count = excluded.held_count
  where public.kakao_sync_state.last_collected_at < excluded.last_collected_at
  returning * into recorded;
  if not found then raise exception 'A newer Kakao sync has already completed'; end if;
  return recorded;
end;
$$;
revoke all on function public.record_kakao_sync(timestamptz, integer, text, integer) from public, anon;
grant execute on function public.record_kakao_sync(timestamptz, integer, text, integer) to authenticated, service_role;
