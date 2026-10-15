create or replace function public.account_can_sign_in(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- W6 item 7, ruling H114 (4): a client sign-in link goes only to an address that is a contact, never archived.
  select exists (
    select 1
    from public.contacts c
    where lower(c.email) = lower(p_email) and c.archived_at is null
  );
$$;

revoke execute on function public.account_can_sign_in(text) from public, anon, authenticated;
grant execute on function public.account_can_sign_in(text) to service_role;
