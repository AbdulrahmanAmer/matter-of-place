-- down:
--   drop policy campaign_reports_select_client on public.campaign_reports;
--   drop policy payments_select_client on public.payments;
--   drop policy submission_media_select_client on public.submission_media;
--   drop policy submissions_select_client on public.submissions;
--   drop policy contacts_select_client on public.contacts;
--   drop function app.client_campaign_ids(), app.client_submission_ids(), app.client_contact_id(), app.contact_of(uuid);
set lock_timeout = '5s';

-- W6 item 7, ruling H113: a client is the signed-in person whose confirmed auth email is a contact's email. The
-- helpers sit in `app`, outside the API (security advisor lint 0029), and the policies only add reads of the client's
-- own rows to the staff policies of migration 10. A client inserts, updates and deletes nothing.

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

create or replace function app.client_contact_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select app.contact_of(auth.uid());
$$;

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

-- The mapping itself takes any user id, so only the service role (through account_room) and the helpers' owner call it.
revoke execute on function app.contact_of(uuid) from public, anon, authenticated;
grant execute on function app.contact_of(uuid) to service_role;
revoke execute on function app.client_contact_id(), app.client_submission_ids(), app.client_campaign_ids()
  from public, anon;
grant execute on function app.client_contact_id(), app.client_submission_ids(), app.client_campaign_ids()
  to authenticated, service_role;

-- Each helper sits in a scalar subquery, so it runs once per statement and not once per row.
create policy contacts_select_client on public.contacts for select to authenticated
  using (id = (select app.client_contact_id()));
create policy submissions_select_client on public.submissions for select to authenticated
  using (contact_id = (select app.client_contact_id()));
create policy submission_media_select_client on public.submission_media for select to authenticated
  using (submission_id = any ((select app.client_submission_ids())));
create policy payments_select_client on public.payments for select to authenticated
  using (submission_id = any ((select app.client_submission_ids())));
create policy campaign_reports_select_client on public.campaign_reports for select to authenticated
  using (campaign_id = any ((select app.client_campaign_ids())));
