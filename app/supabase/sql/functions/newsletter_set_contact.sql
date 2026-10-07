create or replace function public.newsletter_set_contact(p_subscriber uuid, p_contact_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Invariant 13: `syncAudience` keeps the Resend contact id of a member it added.
  update public.subscribers set resend_contact_id = p_contact_id where id = p_subscriber;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.newsletter_set_contact(uuid, text) from public, anon, authenticated;
grant execute on function public.newsletter_set_contact(uuid, text) to service_role;
