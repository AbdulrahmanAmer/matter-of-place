-- down:
--   drop function public.role_in(variadic public.app_role[]), public.is_staff();
set lock_timeout = '5s';

-- RLS policies call these as the signed-in user, so they read `user_roles` as their owner.
create or replace function public.role_in(variadic p_roles public.app_role[])
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
  );
$$;

create or replace function public.is_staff()
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
      and r.disabled_at is null
  );
$$;

revoke execute on function public.role_in(variadic public.app_role[]), public.is_staff() from public, anon;
grant execute on function public.role_in(variadic public.app_role[]), public.is_staff()
to authenticated, service_role;
