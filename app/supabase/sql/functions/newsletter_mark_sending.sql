create or replace function public.newsletter_mark_sending(p_issue uuid, p_approval_count int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Invariant 6: before the broadcast is created. False when the issue was unapproved or approved again since the
  -- job was made, and the send job then exits stale. A resumed job finds it already `sending`.
  update public.newsletter_issues
  set status = 'sending'
  where id = p_issue and status in ('approved', 'sending') and approval_count = p_approval_count;
  return found;
end;
$$;

revoke execute on function public.newsletter_mark_sending(uuid, int) from public, anon, authenticated;
grant execute on function public.newsletter_mark_sending(uuid, int) to service_role;
