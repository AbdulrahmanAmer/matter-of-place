create or replace function app.client_contact_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select app.contact_of(auth.uid());
$$;
