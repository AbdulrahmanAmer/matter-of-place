create or replace function public.set_social_post_inflight(p_id uuid, p_marker text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- INT-01: a compare-and-set. False means another run already holds the row with its own marker; no marker clears it.
  if p_marker is null then
    update public.social_posts set error = null where id = p_id and status = 'scheduled';
    return true;
  end if;
  update public.social_posts
  set error = p_marker
  where id = p_id
    and status = 'scheduled'
    and (error is null or (error not like 'inflight:%' and error not like 'container:%'));
  return found;
end;
$$;

revoke execute on function public.set_social_post_inflight(uuid, text) from public, anon, authenticated;
grant execute on function public.set_social_post_inflight(uuid, text) to service_role;
