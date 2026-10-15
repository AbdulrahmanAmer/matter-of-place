create or replace function app.client_submission_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.id), '{}')
  from public.submissions s
  where s.contact_id = app.client_contact_id();
$$;
