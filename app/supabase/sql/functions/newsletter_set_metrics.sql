create or replace function public.newsletter_set_metrics(p_issue uuid, p_metrics jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- `aggregateIssueMetrics` merges its counts in. `recipients` is the send's own number and is never replaced here.
  if jsonb_typeof(p_metrics) is distinct from 'object' then
    raise exception 'validation' using errcode = '22023';
  end if;
  update public.newsletter_issues set metrics = metrics || (p_metrics - 'recipients') where id = p_issue;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.newsletter_set_metrics(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.newsletter_set_metrics(uuid, jsonb) to service_role;
