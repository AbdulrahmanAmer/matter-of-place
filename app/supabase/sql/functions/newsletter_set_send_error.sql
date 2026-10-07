create or replace function public.newsletter_set_send_error(p_issue uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Invariants 4 to 6: why an approved issue did not leave. The status stays, so a human can act on it.
  update public.newsletter_issues set send_error = p_error where id = p_issue;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.newsletter_set_send_error(uuid, text) from public, anon, authenticated;
grant execute on function public.newsletter_set_send_error(uuid, text) to service_role;
