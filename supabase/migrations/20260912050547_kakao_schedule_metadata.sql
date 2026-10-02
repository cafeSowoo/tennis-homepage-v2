-- Public metadata never includes comment bodies or Kakao account identifiers.
alter table public.schedules add column if not exists kakao_creator_name text;
alter table public.schedules add column if not exists kakao_comment_count integer check (kakao_comment_count >= 0);
alter table public.schedules add column if not exists kakao_synced_at timestamptz;
alter table public.schedules add column if not exists kakao_deeplink text check (kakao_deeplink like 'kakaomoim://post?%');

-- A Google login alone does not establish club membership.
create table public.kakao_comment_readers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  member_id text references public.members(id) on delete cascade
);
alter table public.kakao_comment_readers enable row level security;
revoke all on public.kakao_comment_readers from anon, authenticated;
grant select, insert, update, delete on public.kakao_comment_readers to authenticated;
create policy "read own comment membership" on public.kakao_comment_readers
  for select to authenticated using (user_id = (select auth.uid()));
create policy "owner manages comment membership" on public.kakao_comment_readers
  for all to authenticated
  using (lower((select auth.jwt() ->> 'email')) = 'harminis@gmail.com')
  with check (lower((select auth.jwt() ->> 'email')) = 'harminis@gmail.com');

create table public.kakao_schedule_comments (
  id text primary key references public.schedules(id) on delete cascade,
  source text not null default 'kakao' check (source = 'kakao'),
  comments jsonb not null default '[]'::jsonb check (jsonb_typeof(comments) = 'array'),
  comments_complete boolean not null default false,
  synced_at timestamptz not null
);
alter table public.kakao_schedule_comments enable row level security;
revoke all on public.kakao_schedule_comments from anon, authenticated;
grant select, insert, update, delete on public.kakao_schedule_comments to authenticated;
create policy "members read kakao comments" on public.kakao_schedule_comments
  for select to authenticated using (
    lower((select auth.jwt() ->> 'email')) = 'harminis@gmail.com'
    or exists (select 1 from public.kakao_comment_readers r where r.user_id = (select auth.uid()))
  );
create policy "owner writes kakao comments" on public.kakao_schedule_comments
  for all to authenticated
  using (lower((select auth.jwt() ->> 'email')) = 'harminis@gmail.com')
  with check (lower((select auth.jwt() ->> 'email')) = 'harminis@gmail.com');
