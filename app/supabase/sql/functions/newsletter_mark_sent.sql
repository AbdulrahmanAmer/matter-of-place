create or replace function public.newsletter_mark_sent(p_issue uuid, p_recipients int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  -- Invariant 6: Resend accepted the send. Only a `sending` issue becomes `sent`.
  select i.status into v_status from public.newsletter_issues i where i.id = p_issue for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'sending' then
    raise exception 'wrong_state' using errcode = '55000';
  end if;
  update public.newsletter_issues
  set status = 'sent',
    sent_at = now(),
    send_error = null,
    metrics = metrics || jsonb_build_object('recipients', p_recipients)
  where id = p_issue;
end;
$$;

revoke execute on function public.newsletter_mark_sent(uuid, int) from public, anon, authenticated;
grant execute on function public.newsletter_mark_sent(uuid, int) to service_role;
