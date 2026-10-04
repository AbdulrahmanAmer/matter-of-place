create or replace function public.retention_anonymise_inquiries(p_keep interval, p_dry_run boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  -- G23: an inquiry older than p_keep keeps its row for the counts and loses what names a person. name and message are
  -- not null, so they become ''; the address becomes a hash no one can write to.
  select coalesce(array_agg(id), '{}') into v_ids
  from public.inquiries
  where received_at < now() - p_keep and anonymised_at is null;
  if p_dry_run then
    return cardinality(v_ids);
  end if;
  update public.inquiries
  set name = '',
    message = '',
    phone = null,
    location = null,
    details = '{}'::jsonb,
    forwarded_payload = null,
    email = encode(sha256(convert_to(email, 'UTF8')), 'hex') || '@anonymised.invalid',
    anonymised_at = now()
  where id = any(v_ids);
  -- B15 adds attribution; until then the column does not exist.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inquiries' and column_name = 'attribution'
  ) then
    execute 'update public.inquiries set attribution = ''{}''::jsonb where id = any($1)' using v_ids;
  end if;
  -- G16: a webhook job of the inquiry keeps no copy of its body.
  update public.jobs
  set result = result - 'body'
  where type = 'webhook_omnikom'
    and payload -> 'data' ->> 'inquiry_id' = any(v_ids::text[])
    and result ? 'body';
  return cardinality(v_ids);
end;
$$;

revoke execute on function public.retention_anonymise_inquiries(interval, boolean) from public, anon, authenticated;
grant execute on function public.retention_anonymise_inquiries(interval, boolean) to service_role;
