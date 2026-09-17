-- Additive only: preserve the existing V1 owner and public-read policies.
-- Membership comes from the approved, active account helper, never user metadata.
create policy "club members insert own homepage discussions"
on public.discussions for insert to authenticated
with check (
  member_id = (select club_private.club_current_member_id())
  and source = 'supabase'
  and char_length(btrim(message)) between 1 and 2000
);

create policy "club members delete own or admins delete homepage discussions"
on public.discussions for delete to authenticated
using (
  coalesce(source, 'supabase') <> 'kakao'
  and (
    member_id = (select club_private.club_current_member_id())
    or (select club_private.club_is_admin())
  )
);
