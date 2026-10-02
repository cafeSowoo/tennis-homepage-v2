create table public.kakao_sync_state (
  id text primary key check (id = 'kakao'),
  last_collected_at timestamptz not null,
  completed_at timestamptz not null default now(),
  schedule_count integer not null check (schedule_count >= 0),
  batch_fingerprint text not null check (length(batch_fingerprint) = 64)
);
alter table public.kakao_sync_state enable row level security;
revoke all on public.kakao_sync_state from anon, authenticated;
grant select on public.kakao_sync_state to anon, authenticated;
grant insert, update on public.kakao_sync_state to authenticated;
create policy "public reads kakao sync state" on public.kakao_sync_state for select using (true);
create policy "owner inserts kakao sync state" on public.kakao_sync_state for insert to authenticated
  with check (lower((select auth.jwt() ->> 'email')) = 'harminis@gmail.com');
create policy "owner updates kakao sync state" on public.kakao_sync_state for update to authenticated
  using (lower((select auth.jwt() ->> 'email')) = 'harminis@gmail.com')
  with check (lower((select auth.jwt() ->> 'email')) = 'harminis@gmail.com');

create function public.record_kakao_sync(p_collected_at timestamptz, p_schedule_count integer, p_fingerprint text)
returns public.kakao_sync_state language plpgsql security invoker set search_path = '' as $$
declare recorded public.kakao_sync_state;
begin
  if lower(coalesce((select auth.jwt() ->> 'email'), '')) <> 'harminis@gmail.com' then
    raise exception 'Owner login required' using errcode = '42501';
  end if;
  select * into recorded from public.kakao_sync_state where id = 'kakao';
  if recorded.last_collected_at = p_collected_at and recorded.batch_fingerprint = p_fingerprint then
    return recorded;
  end if;
  insert into public.kakao_sync_state(id,last_collected_at,schedule_count,batch_fingerprint)
    values ('kakao',p_collected_at,p_schedule_count,p_fingerprint)
  on conflict(id) do update set
    last_collected_at = excluded.last_collected_at, completed_at = now(),
    schedule_count = excluded.schedule_count, batch_fingerprint = excluded.batch_fingerprint
  where public.kakao_sync_state.last_collected_at < excluded.last_collected_at
  returning * into recorded;
  if not found then raise exception 'A newer Kakao sync has already completed'; end if;
  return recorded;
end;
$$;
revoke all on function public.record_kakao_sync(timestamptz,integer,text) from public, anon;
grant execute on function public.record_kakao_sync(timestamptz,integer,text) to authenticated;
