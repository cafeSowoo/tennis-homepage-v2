-- Admin-only deletion for pilot feedback. Direct table DELETE remains revoked.
create function club_private.v2_delete_feedback(p_id uuid,p_version integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.v2_feedback;
begin
 if auth.uid() is null or not club_private.club_is_admin() then
  raise exception 'Admin required' using errcode='42501';
 end if;
 if p_id is null or p_version is null then
  raise exception 'Invalid feedback delete' using errcode='22023';
 end if;
 select * into r from public.v2_feedback where id=p_id for update;
 if not found then raise exception 'Feedback unavailable' using errcode='P0002'; end if;
 if p_version<>r.version then raise exception 'Refresh first' using errcode='40001'; end if;
 delete from public.v2_feedback where id=p_id;
 return true;
end $$;

create function public.v2_delete_feedback(p_id uuid,p_version integer)
returns boolean language sql security invoker set search_path='' as $$
 select club_private.v2_delete_feedback(p_id,p_version)
$$;

revoke all on function club_private.v2_delete_feedback(uuid,integer),public.v2_delete_feedback(uuid,integer)
 from public,anon,authenticated;
grant execute on function club_private.v2_delete_feedback(uuid,integer),public.v2_delete_feedback(uuid,integer)
 to authenticated;
