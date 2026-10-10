create or replace function public.team_users(p_limit integer default 50, p_cursor uuid default null)
returns table (
  user_id uuid,
  email text,
  display_name text,
  roles public.app_role[],
  actor_kind public.actor_kind,
  disabled boolean,
  last_active_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Screen 23: one row per user of `user_roles`, keyset-paged on the leading column of `unique (user_id, role)`.
  select r.user_id,
    u.email::text,
    max(r.display_name),
    array_agg(r.role order by r.role),
    min(r.actor_kind),
    bool_and(r.disabled_at is not null),
    greatest(u.last_sign_in_at, (select max(k.last_used_at) from public.agent_keys k where k.user_id = r.user_id))
  from public.user_roles r
  join auth.users u on u.id = r.user_id
  where p_cursor is null or r.user_id > p_cursor
  group by r.user_id, u.email, u.last_sign_in_at
  order by r.user_id
  limit least(greatest(coalesce(p_limit, 50), 1), 50);
$$;

revoke execute on function public.team_users(integer, uuid) from public, anon, authenticated;
grant execute on function public.team_users(integer, uuid) to service_role;
