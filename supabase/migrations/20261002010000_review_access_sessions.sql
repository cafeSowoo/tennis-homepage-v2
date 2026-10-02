-- Review mode (shared club password) used to hand every visitor the same
-- never-expiring token, with no limit on password guesses. Each login now gets
-- its own token that lapses after 60 idle days, and repeated wrong passwords
-- lock the login for a while. The old shared token keeps working until
-- 2026-10-16 so open pages can trade it in through review_access_renew.

create table if not exists club_private.review_access_sessions (
  token uuid primary key default extensions.gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null
);

create table if not exists club_private.review_login_failures (
  client_key text not null,
  failed_at timestamptz not null default clock_timestamp()
);

create index if not exists review_login_failures_client_time
  on club_private.review_login_failures(client_key, failed_at);
create index if not exists review_login_failures_time
  on club_private.review_login_failures(failed_at);

revoke all on table club_private.review_access_sessions from public, anon, authenticated;
revoke all on table club_private.review_login_failures from public, anon, authenticated;

create or replace function club_private.review_token_valid(p_token text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select char_length(coalesce(p_token, '')) between 32 and 40
    and (
      exists (
        select 1
        from club_private.review_access_sessions s
        where s.token::text = p_token
          and s.expires_at > clock_timestamp()
      )
      or exists (
        select 1
        from club_private.review_access_config cfg
        where cfg.singleton = true
          and cfg.access_token::text = p_token
          and clock_timestamp() < timestamptz '2026-10-16 00:00:00+09'
      )
    );
$$;

revoke all on function club_private.review_token_valid(text) from public, anon, authenticated;

-- Cloudflare sets cf-connecting-ip in front of the Supabase API; without it every
-- caller shares one key, which still caps guesses.
create or replace function club_private.review_login_client_key()
returns text
language sql
stable
set search_path to ''
as $$
  select coalesce(
    nullif(left(coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json ->> 'cf-connecting-ip', 64), ''),
    'unknown'
  );
$$;

revoke all on function club_private.review_login_client_key() from public, anon, authenticated;

create or replace function public.review_access_login(p_password text)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  cfg club_private.review_access_config%rowtype;
  client text := club_private.review_login_client_key();
  new_token uuid;
begin
  delete from club_private.review_login_failures
  where failed_at < clock_timestamp() - interval '1 day';
  delete from club_private.review_access_sessions
  where expires_at < clock_timestamp();

  if (
    select count(*)
    from club_private.review_login_failures f
    where f.client_key = client
      and f.failed_at > clock_timestamp() - interval '15 minutes'
  ) >= 10 or (
    select count(*)
    from club_private.review_login_failures f
    where f.failed_at > clock_timestamp() - interval '1 hour'
  ) >= 60 then
    raise exception 'Too many attempts' using errcode = '54000';
  end if;

  if p_password is null or char_length(p_password) < 4 or char_length(p_password) > 128 then
    insert into club_private.review_login_failures(client_key) values (client);
    return null;
  end if;

  select * into cfg
  from club_private.review_access_config
  where singleton = true;

  if not found then
    return null;
  end if;

  if extensions.crypt(p_password, cfg.password_hash) <> cfg.password_hash then
    insert into club_private.review_login_failures(client_key) values (client);
    return null;
  end if;

  insert into club_private.review_access_sessions(expires_at)
  values (clock_timestamp() + interval '60 days')
  returning token into new_token;
  return new_token::text;
end;
$$;

-- Called when a page opens: extends a session token, or trades the old shared
-- token for a session token. Returns null when the token is no longer valid.
create or replace function public.review_access_renew(p_token text)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  new_token uuid;
begin
  if not club_private.review_token_valid(p_token) then
    return null;
  end if;

  update club_private.review_access_sessions
  set expires_at = clock_timestamp() + interval '60 days'
  where token::text = p_token;
  if found then
    return p_token;
  end if;

  insert into club_private.review_access_sessions(expires_at)
  values (clock_timestamp() + interval '60 days')
  returning token into new_token;
  return new_token::text;
end;
$$;

create or replace function public.review_access_check(p_token text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select club_private.review_token_valid(p_token);
$$;

create or replace function public.review_kakao_comments(p_token text, p_schedule_id text)
returns table (
  comment_id text,
  author_name text,
  message text,
  created_at text
)
language sql
security definer
set search_path to ''
as $$
  select
    case
      when nullif(comment_row.comment ->> 'id', '') is not null then comment_row.comment ->> 'id'
      else 'review-' || comment_row.ordinality::text
    end as comment_id,
    coalesce(nullif(comment_row.comment ->> 'author_name', ''), '카카오 회원') as author_name,
    club_private.mask_review_comment_message(comment_row.comment ->> 'message') as message,
    coalesce(comment_row.comment ->> 'created_at', '') as created_at
  from public.kakao_schedule_comments snapshot
  join public.schedules schedule on schedule.id = snapshot.id
  cross join lateral jsonb_array_elements(snapshot.comments) with ordinality as comment_row(comment, ordinality)
  where snapshot.id = p_schedule_id
    and schedule.source = 'kakao'
    and schedule.date >= (clock_timestamp() at time zone 'Asia/Seoul')::date
    and club_private.review_token_valid(p_token)
  order by comment_row.ordinality;
$$;

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
set search_path to ''
as $$
declare
  r public.v2_feedback;
  selected_member_name text;
begin
  if not club_private.review_token_valid(p_token) then
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

revoke all on function public.review_access_login(text) from public, anon, authenticated;
revoke all on function public.review_access_renew(text) from public, anon, authenticated;
revoke all on function public.review_access_check(text) from public, anon, authenticated;
grant execute on function public.review_access_login(text) to anon, authenticated;
grant execute on function public.review_access_renew(text) to anon, authenticated;
grant execute on function public.review_access_check(text) to anon, authenticated;
