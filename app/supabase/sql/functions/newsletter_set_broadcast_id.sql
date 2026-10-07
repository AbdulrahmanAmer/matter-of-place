create or replace function public.newsletter_set_broadcast_id(p_issue uuid, p_broadcast_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Invariant 6, INT-10: written right after create and before send. The first id stays, so a resumed job sends the
  -- broadcast it already created.
  update public.newsletter_issues
  set resend_broadcast_id = coalesce(resend_broadcast_id, p_broadcast_id)
  where id = p_issue;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.newsletter_set_broadcast_id(uuid, text) from public, anon, authenticated;
grant execute on function public.newsletter_set_broadcast_id(uuid, text) to service_role;
