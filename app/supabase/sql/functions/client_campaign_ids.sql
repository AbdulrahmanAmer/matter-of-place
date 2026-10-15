create or replace function app.client_campaign_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  -- A campaign belongs to the client whose submission its payment invoices.
  select coalesce(array_agg(c.id), '{}')
  from public.campaigns c
  join public.payments p on p.id = c.payment_id
  join public.submissions s on s.id = p.submission_id
  where s.contact_id = app.client_contact_id();
$$;
