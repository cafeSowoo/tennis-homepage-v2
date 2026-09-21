-- Allow password-gated Review Mode visitors to submit feedback without exposing
-- feedback history to anonymous clients. Existing authenticated feedback remains
-- unchanged and administrators can continue to manage all rows.
alter table public.v2_feedback
  alter column author_user_id drop not null;

create or replace function public.review_submit_feedback(
  p_token text,
  p_member_id text,
  p_id uuid,
  p_category text,
  p_body text,
  p_view text,
  p_client_version text
)
returns public.v2_feedback
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.v2_feedback;
  selected_member_name text;
begin
  if not exists (
    select 1
    from club_private.review_access_config cfg
    where cfg.singleton = true
      and char_length(coalesce(p_token, '')) between 32 and 40
      and cfg.access_token::text = p_token
  ) then
    raise exception 'Review access required' using errcode = '42501';
  end if;

  select m.name
  into selected_member_name
  from public.members m
  where m.id = p_member_id
    and coalesce(m.status, 'active') = 'active';

  if not found then
    raise exception 'Active member required' using errcode = '42501';
  end if;

  if p_id is null
    or p_category is null
    or p_category not in ('error', 'inconvenience', 'suggestion')
    or p_body is null
    or length(btrim(p_body)) not between 1 and 4000
    or p_view is null
    or p_view not in ('dashboard', 'schedule', 'detail', 'members', 'member-detail', 'other')
    or p_client_version is null
    or p_client_version !~ '^([a-f0-9]{7,40}|development)$'
  then
    raise exception 'Invalid feedback' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('v2_feedback:' || p_id::text, 0));
  select *
  into r
  from public.v2_feedback
  where id = p_id;

  if found then
    if r.author_user_id is not null or r.member_id <> p_member_id then
      raise exception 'Feedback unavailable' using errcode = '42501';
    end if;
    if (r.category, r.body, r.view_name, r.client_version) is distinct from
       (p_category, btrim(p_body), p_view, p_client_version) then
      raise exception 'Request id already used' using errcode = '23505';
    end if;
    return r;
  end if;

  insert into public.v2_feedback(
    id,
    author_user_id,
    member_id,
    author_name,
    category,
    body,
    view_name,
    schedule_id,
    client_version
  )
  values(
    p_id,
    null,
    p_member_id,
    selected_member_name,
    p_category,
    btrim(p_body),
    p_view,
    null,
    p_client_version
  )
  returning * into r;

  return r;
end;
$$;

revoke all on function public.review_submit_feedback(text, text, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.review_submit_feedback(text, text, uuid, text, text, text, text)
  to anon, authenticated;
