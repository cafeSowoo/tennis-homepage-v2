create or replace function club_private.mask_review_comment_message(p_message text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    regexp_replace(
      regexp_replace(
        coalesce(p_message, ''),
        '([0-9]{2,4})[- ]+[0-9]{2,6}[- ]+[0-9]{2,8}[- ]+[0-9]{2,8}',
        E'\\1-**-**-****',
        'g'
      ),
      '([0-9]{2,4})[- ]+[0-9]{2,6}[- ]+[0-9]{3,10}',
      E'\\1-**-******',
      'g'
    ),
    '([0-9]{3})[0-9]{7,11}',
    E'\\1******',
    'g'
  );
$$;

revoke all on function club_private.mask_review_comment_message(text) from public, anon, authenticated;

create or replace function public.review_kakao_comments(p_token text, p_schedule_id text)
returns table (
  comment_id text,
  author_name text,
  message text,
  created_at text
)
language sql
security definer
set search_path = ''
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
    and exists (
      select 1
      from club_private.review_access_config cfg
      where cfg.singleton = true
        and char_length(coalesce(p_token, '')) between 32 and 40
        and cfg.access_token::text = p_token
    )
  order by comment_row.ordinality;
$$;

revoke all on function public.review_kakao_comments(text, text) from public, anon, authenticated;
grant execute on function public.review_kakao_comments(text, text) to anon, authenticated;
