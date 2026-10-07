create or replace function public.newsletter_clear_contact(p_contact_id text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  -- Invariant 13: after `syncAudience` removed a contact, no subscriber row points at it.
  update public.subscribers set resend_contact_id = null where resend_contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.newsletter_clear_contact(text) from public, anon, authenticated;
grant execute on function public.newsletter_clear_contact(text) to service_role;
