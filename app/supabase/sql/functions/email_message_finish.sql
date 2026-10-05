create or replace function public.email_message_finish(p_id uuid, p_status text, p_resend_id text default null, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status is null or p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'invalid_status';
  end if;
  -- A row that is sent, or moved further by a provider event, stays where it is; only `sent` counts against the caps.
  update public.email_messages
  set status = p_status,
    resend_id = p_resend_id,
    error = p_error,
    sent_at = case when p_status = 'sent' then now() else sent_at end
  where id = p_id and status not in ('sent', 'delivered', 'bounced', 'complained');
end;
$$;

revoke execute on function public.email_message_finish(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.email_message_finish(uuid, text, text, text) to service_role;
