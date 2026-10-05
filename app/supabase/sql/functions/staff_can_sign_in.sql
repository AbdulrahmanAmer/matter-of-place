create or replace function public.staff_can_sign_in(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Invariant 19: a sign-in link goes only to an address that holds an enabled role.
  select exists (
    select 1
    from auth.users u
    join public.user_roles r on r.user_id = u.id
    where lower(u.email) = lower(p_email) and r.disabled_at is null
  );
$$;

revoke execute on function public.staff_can_sign_in(text) from public, anon, authenticated;
grant execute on function public.staff_can_sign_in(text) to service_role;
