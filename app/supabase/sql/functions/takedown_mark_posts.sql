create or replace function public.takedown_mark_posts(p_property_id uuid)
returns int
language sql
security definer
set search_path = ''
as $$
  -- B8 step 10a (E2E-01): a post a channel already shows cannot be deleted from here, so each one is marked for
  -- withdrawal by hand (B10's screen 12). Returns how many rows it marked; a rerun marks none.
  with marked as (
    update public.social_posts
    set withdraw_required_at = now()
    where property_id = p_property_id and status = 'posted' and withdraw_required_at is null
    returning 1
  )
  select count(*)::int from marked;
$$;

revoke execute on function public.takedown_mark_posts(uuid) from public, anon, authenticated;
grant execute on function public.takedown_mark_posts(uuid) to service_role;
