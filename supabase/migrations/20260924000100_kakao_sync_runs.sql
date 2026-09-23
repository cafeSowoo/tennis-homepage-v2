-- One row per scheduled Kakao sync run (tools/kakao-tennis-schedules supervisor).
-- Only the owner session used by the sync can add rows; nobody can read the
-- table directly. The review page reads it through sync_admin_runs(), which
-- checks a separate admin password stored only as a bcrypt hash.
-- No error text, credentials or Kakao content is stored.
create table public.kakao_sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null unique,
  finished_at timestamptz not null,
  status text not null check (status in ('ok', 'error')),
  error_kind text check (char_length(error_kind) <= 64),
  attempt_count integer check (attempt_count between 0 and 10),
  elapsed_seconds numeric(8,1) check (elapsed_seconds >= 0),
  operation_count integer check (operation_count >= 0),
  held_count integer check (held_count >= 0),
  deletion_review_count integer check (deletion_review_count >= 0),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  recovery text check (char_length(recovery) <= 64),
  release_id text check (char_length(release_id) <= 64),
  recorded_at timestamptz not null default now()
);
alter table public.kakao_sync_runs enable row level security;
revoke all on public.kakao_sync_runs from public, anon, authenticated;
grant insert on public.kakao_sync_runs to authenticated;
create policy "owner records kakao sync runs" on public.kakao_sync_runs for insert to authenticated
  with check (lower((select auth.jwt() ->> 'email')) = 'harminis@gmail.com');

create table if not exists club_private.sync_admin_config (
  singleton boolean primary key default true check (singleton),
  password_hash text not null,
  updated_at timestamptz not null default clock_timestamp()
);
revoke all on table club_private.sync_admin_config from public, anon, authenticated;

create function public.sync_admin_runs(p_password text, p_limit integer default 72)
returns setof public.kakao_sync_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg club_private.sync_admin_config%rowtype;
begin
  select * into cfg from club_private.sync_admin_config where singleton = true;
  if not found
     or p_password is null
     or char_length(p_password) not between 8 and 128
     or extensions.crypt(p_password, cfg.password_hash) <> cfg.password_hash then
    perform pg_sleep(0.5);  -- slow down guessing
    raise exception 'Invalid sync admin password' using errcode = '42501';
  end if;
  return query
    select * from public.kakao_sync_runs
    order by started_at desc
    limit least(greatest(coalesce(p_limit, 72), 1), 500);
end;
$$;
revoke all on function public.sync_admin_runs(text, integer) from public, anon, authenticated;
grant execute on function public.sync_admin_runs(text, integer) to anon, authenticated;
