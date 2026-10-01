-- The Kakao sync now reads with its owner session (TennisBomSync f66777e), so
-- drop the temporary anon reads on members, schedules and events.
drop policy if exists "temporary public read members for kakao sync" on public.members;
drop policy if exists "temporary public read schedules for kakao sync" on public.schedules;
drop policy if exists "temporary public read events for kakao sync" on public.events;
revoke select on public.members, public.schedules, public.events from anon;
