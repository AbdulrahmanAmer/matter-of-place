create or replace function public.is_last_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- True when this user holds the only enabled `admin` row of a person: taking it away would leave no one to run the
  -- team, since an agent is refused on every `team` route (invariant 3).
  select exists (
      select 1 from public.user_roles r
      where r.user_id = p_user_id and r.role = 'admin' and r.disabled_at is null and r.actor_kind = 'human'
    )
    and not exists (
      select 1 from public.user_roles r
      where r.user_id <> p_user_id and r.role = 'admin' and r.disabled_at is null and r.actor_kind = 'human'
    );
$$;

revoke execute on function public.is_last_admin(uuid) from public, anon, authenticated;
grant execute on function public.is_last_admin(uuid) to service_role;
