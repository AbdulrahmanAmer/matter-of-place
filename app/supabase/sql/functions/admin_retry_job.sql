create or replace function public.admin_retry_job(
  p_job_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.job_status;
begin
  -- Screen 16 (B8 step 9): a dead or failed job runs again from attempt 0, audited in the same transaction.
  select j.status into v_status from public.jobs j where j.id = p_job_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_status not in ('dead', 'failed') then
    raise exception 'invalid_state';
  end if;
  perform public.requeue_job(p_job_id => p_job_id, p_claim => null, p_run_after => now(), p_kind => 'manual_retry');
  perform public.write_audit(
    p_actor, p_actor_kind, 'jobs.retry', 'job', p_job_id,
    jsonb_build_object('id', p_job_id, 'status', v_status),
    jsonb_build_object('id', p_job_id, 'status', 'queued'),
    p_request_id
  );
end;
$$;

revoke execute on function public.admin_retry_job(uuid, uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.admin_retry_job(uuid, uuid, public.actor_kind, text) to service_role;
