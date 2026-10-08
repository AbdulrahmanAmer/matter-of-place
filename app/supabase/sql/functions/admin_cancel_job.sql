create or replace function public.admin_cancel_job(
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
  -- Screen 16 (B8 step 9): a job that has not run yet, or waits for its next attempt, is cancelled and audited.
  select j.status into v_status from public.jobs j where j.id = p_job_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_status not in ('queued', 'failed', 'waiting_approval') then
    raise exception 'invalid_state';
  end if;
  perform public.cancel_job(p_job_id => p_job_id, p_actor_id => p_actor);
  perform public.write_audit(
    p_actor, p_actor_kind, 'jobs.cancel', 'job', p_job_id,
    jsonb_build_object('id', p_job_id, 'status', v_status),
    jsonb_build_object('id', p_job_id, 'status', 'cancelled'),
    p_request_id
  );
end;
$$;

revoke execute on function public.admin_cancel_job(uuid, uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.admin_cancel_job(uuid, uuid, public.actor_kind, text) to service_role;
