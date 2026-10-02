-- Review mode (shared password) reads members and Kakao schedules through the
-- review access token instead of anonymous table reads, so the public tables
-- can be closed to the anon role.

create or replace function club_private.review_token_valid(p_token text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from club_private.review_access_config cfg
    where cfg.singleton = true
      and char_length(coalesce(p_token, '')) between 32 and 40
      and cfg.access_token::text = p_token
  );
$$;

revoke all on function club_private.review_token_valid(text) from public, anon, authenticated;

create or replace function public.review_members(p_token text)
returns setof public.members
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not club_private.review_token_valid(p_token) then
    raise exception 'Review access expired' using errcode = '42501';
  end if;
  return query select * from public.members order by id;
end;
$$;

create or replace function public.review_kakao_schedules(p_token text)
returns setof public.schedules
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not club_private.review_token_valid(p_token) then
    raise exception 'Review access expired' using errcode = '42501';
  end if;
  return query select * from public.schedules where source = 'kakao' order by date, time, id;
end;
$$;

revoke all on function public.review_members(text) from public;
revoke all on function public.review_kakao_schedules(text) from public;
grant execute on function public.review_members(text) to anon, authenticated;
grant execute on function public.review_kakao_schedules(text) to anon, authenticated;
