create or replace function public.retention_anonymise_contacts(p_keep interval, p_dry_run boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  -- S55: a person with no open request and no published property, whose last request (or the contact itself, with
  -- none) is older than p_keep, loses what names them; the same columns as B7's delete_subject.
  select coalesce(array_agg(c.id), '{}') into v_ids
  from public.contacts c
  where c.archived_at is null
    and coalesce(
      (select max(s.updated_at) from public.submissions s where s.contact_id = c.id), c.updated_at
    ) < now() - p_keep
    and not exists (
      select 1 from public.submissions s
      where s.contact_id = c.id and s.workflow_state not in ('Declined', 'Withdrawn', 'Completed')
    )
    and not exists (
      select 1 from public.submissions s
      join public.properties p on p.submission_id = s.id
      where s.contact_id = c.id and p.editorial_state = 'published'
    );
  if p_dry_run then
    return cardinality(v_ids);
  end if;
  update public.submissions s
  set submitter_name = '',
    submitter_email = encode(sha256(convert_to(c.email, 'UTF8')), 'hex') || '@anonymised.invalid',
    submitter_phone = null,
    listing_agent_name = null
  from public.contacts c
  where c.id = s.contact_id and c.id = any(v_ids);
  update public.contacts
  set name = '',
    email = encode(sha256(convert_to(email, 'UTF8')), 'hex') || '@anonymised.invalid',
    phone = null,
    brokerage = null,
    notes = null,
    archived_at = now()
  where id = any(v_ids);
  update public.retention_policies
  set last_run_at = now(), last_count = cardinality(v_ids)
  where key = 'contacts_anonymise';
  return cardinality(v_ids);
end;
$$;

revoke execute on function public.retention_anonymise_contacts(interval, boolean) from public, anon, authenticated;
grant execute on function public.retention_anonymise_contacts(interval, boolean) to service_role;
