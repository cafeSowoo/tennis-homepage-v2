-- V1 is retired (cafesowoo.github.io/tennis-homepage now redirects to tennisbom.com).
-- Close the shared V1 tables to anonymous reads. The owner (Kakao sync, admin) and
-- approved club members keep reading them; review mode goes through
-- review_members / review_kakao_schedules. courts, court_units and
-- kakao_sync_state hold no personal data and stay public.

drop policy if exists "public read members" on public.members;
drop policy if exists "public read schedules" on public.schedules;
drop policy if exists "public read discussions" on public.discussions;
drop policy if exists "public read events" on public.events;
drop policy if exists "public read schedule declines" on public.schedule_declines;
drop policy if exists "public reads rsvp overrides" on public.schedule_rsvp_overrides;

revoke select on public.members, public.schedules, public.discussions, public.events,
  public.schedule_declines, public.schedule_rsvp_overrides from anon;

create policy "owner or approved members read members" on public.members
  for select to authenticated
  using (lower((select auth.jwt() ->> 'email')) = 'harminis@gmail.com'
         or (select club_private.club_current_member_id()) is not null);

create policy "owner or approved members read schedules" on public.schedules
  for select to authenticated
  using (lower((select auth.jwt() ->> 'email')) = 'harminis@gmail.com'
         or (select club_private.club_current_member_id()) is not null);

create policy "owner or approved members read discussions" on public.discussions
  for select to authenticated
  using (lower((select auth.jwt() ->> 'email')) = 'harminis@gmail.com'
         or (select club_private.club_current_member_id()) is not null);

create policy "owner or approved members read events" on public.events
  for select to authenticated
  using (lower((select auth.jwt() ->> 'email')) = 'harminis@gmail.com'
         or (select club_private.club_current_member_id()) is not null);

create policy "owner or approved members read schedule declines" on public.schedule_declines
  for select to authenticated
  using (lower((select auth.jwt() ->> 'email')) = 'harminis@gmail.com'
         or (select club_private.club_current_member_id()) is not null);

create policy "owner or approved members read rsvp overrides" on public.schedule_rsvp_overrides
  for select to authenticated
  using (lower((select auth.jwt() ->> 'email')) = 'harminis@gmail.com'
         or (select club_private.club_current_member_id()) is not null);
