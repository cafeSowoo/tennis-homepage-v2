-- parse-reservation-image calls a paid AI service for any approved member with no
-- cap. The function now claims one slot per read; each login gets 30 reads an hour.

create table if not exists club_private.ai_image_requests (
  user_id uuid not null,
  requested_at timestamptz not null default clock_timestamp()
);

create index if not exists ai_image_requests_user_time
  on club_private.ai_image_requests(user_id, requested_at);

revoke all on table club_private.ai_image_requests from public, anon, authenticated;

create or replace function public.claim_ai_image_request()
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return false;
  end if;

  delete from club_private.ai_image_requests
  where requested_at < clock_timestamp() - interval '1 day';

  if (
    select count(*)
    from club_private.ai_image_requests r
    where r.user_id = uid
      and r.requested_at > clock_timestamp() - interval '1 hour'
  ) >= 30 then
    return false;
  end if;

  insert into club_private.ai_image_requests(user_id) values (uid);
  return true;
end;
$$;

revoke all on function public.claim_ai_image_request() from public, anon, authenticated;
grant execute on function public.claim_ai_image_request() to authenticated;
