create or replace function public.mark_inquiry_forwarded(p_inquiry_id uuid, p_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The job-step write of webhook_omnikom (B15, G43): a closed inquiry is never reopened, an anonymised one never refilled.
  update public.inquiries
  set forwarded_at = now(),
    forwarded_payload = p_payload,
    state = case when state in ('new', 'in_progress') then 'forwarded'::public.inquiry_state else state end
  where id = p_inquiry_id and anonymised_at is null;
  return found;
end;
$$;

revoke execute on function public.mark_inquiry_forwarded(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.mark_inquiry_forwarded(uuid, jsonb) to service_role;
