create table if not exists club_private.review_access_config (
  singleton boolean primary key default true check (singleton),
  password_hash text not null,
  access_token uuid not null default extensions.gen_random_uuid(),
  updated_at timestamptz not null default clock_timestamp()
);

revoke all on table club_private.review_access_config from public, anon, authenticated;

create or replace function public.review_access_login(p_password text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg club_private.review_access_config%rowtype;
begin
  if p_password is null or char_length(p_password) < 4 or char_length(p_password) > 128 then
    return null;
  end if;

  select * into cfg
  from club_private.review_access_config
  where singleton = true;

  if not found then
    return null;
  end if;

  if extensions.crypt(p_password, cfg.password_hash) = cfg.password_hash then
    return cfg.access_token::text;
  end if;

  return null;
end;
$$;

create or replace function public.review_access_check(p_token text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
    from club_private.review_access_config
    where singleton = true
      and char_length(coalesce(p_token, '')) between 32 and 40
      and access_token::text = p_token
  ), false);
$$;

revoke all on function public.review_access_login(text) from public, anon, authenticated;
revoke all on function public.review_access_check(text) from public, anon, authenticated;
grant execute on function public.review_access_login(text) to anon, authenticated;
grant execute on function public.review_access_check(text) to anon, authenticated;
