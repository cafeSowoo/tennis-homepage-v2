-- Temporary: the Kakao sync (TennisBomSync compare/dry-run) still reads these
-- three tables with only the publishable key. Reopen them until the sync reads
-- with its owner session. discussions, schedule_declines and
-- schedule_rsvp_overrides stay closed.
grant select on public.members, public.schedules, public.events to anon;
create policy "temporary public read members for kakao sync" on public.members for select to anon using (true);
create policy "temporary public read schedules for kakao sync" on public.schedules for select to anon using (true);
create policy "temporary public read events for kakao sync" on public.events for select to anon using (true);
