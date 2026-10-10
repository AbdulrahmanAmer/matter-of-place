create or replace function public.forward_inquiry(
  p_inquiry_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.inquiries;
  v_job uuid;
begin
  -- Screen 11: one more `webhook_omnikom` job, keyed `webhook_omnikom:<id>:<n>` by B8. The state stays as it is:
  -- B15's step sets `forwarded` after Omnikom answers 2xx. A closed or anonymised inquiry is not sent.
  select * into v_before from public.inquiries i where i.id = p_inquiry_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_before.state = 'closed' or v_before.anonymised_at is not null then
    raise exception 'wrong_state';
  end if;

  v_job := public.enqueue_job_manual(
    'webhook_omnikom',
    p_inquiry_id,
    jsonb_build_object('data', jsonb_build_object('inquiry_id', p_inquiry_id))
  );
  -- DB-09: no job means no forward, so the audit row is not written and nothing reports one.
  if v_job is null then
    raise exception 'enqueue_failed';
  end if;

  perform public.write_audit(
    p_actor, p_actor_kind, 'inquiries.forward', 'inquiry', p_inquiry_id,
    jsonb_build_object('id', p_inquiry_id),
    jsonb_build_object('id', p_inquiry_id, 'job_id', v_job),
    p_request_id
  );
  return v_job;
end;
$$;

revoke execute on function public.forward_inquiry(uuid, uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.forward_inquiry(uuid, uuid, public.actor_kind, text) to service_role;
