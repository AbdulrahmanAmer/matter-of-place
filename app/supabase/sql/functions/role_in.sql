create or replace function app.role_in(variadic p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles r
    where r.user_id = auth.uid()
      and r.role = any (p_roles)
      and r.disabled_at is null
      and r.actor_kind = 'human'
      and not exists (select 1 from public.agent_keys k where k.user_id = r.user_id)
  );
$$;
