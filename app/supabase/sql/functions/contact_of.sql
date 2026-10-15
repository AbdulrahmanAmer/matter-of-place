create or replace function app.contact_of(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- Ruling H113 (1): a client is the auth user whose confirmed email is a contact's email, ignoring case (one contact
  -- per lower(email), invariant 22). An archived contact has no client.
  select c.id
  from auth.users u
  join public.contacts c on lower(c.email) = lower(u.email)
  where u.id = p_user
    and u.email_confirmed_at is not null
    and c.archived_at is null;
$$;
