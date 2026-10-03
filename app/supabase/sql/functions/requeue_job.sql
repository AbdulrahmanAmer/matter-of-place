create or replace function public.requeue_job(
  p_job_id uuid,
  p_claim text,
  p_run_after timestamptz,
  p_kind text,
  p_result jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_attempts int;
begin
  if p_kind = 'requeued' then
    -- A step's retry_at or a runner wait: only under the run's claim, and no attempt is used (invariant 3).
    select * into v_job
    from public.jobs j
    where j.id = p_job_id and j.status = 'running' and j.locked_by = p_claim
    for update;
  elsif p_kind = 'manual_retry' then
    select * into v_job
    from public.jobs j
    where j.id = p_job_id and j.status in ('dead', 'failed')
    for update;
  else
    raise exception 'invalid_kind';
  end if;
  if not found then
    return false;
  end if;
  v_attempts := case when p_kind = 'manual_retry' then 0 else v_job.attempts end;
  if v_job.msg_id is not null then
    perform public.job_queue_delete(v_job.heavy, v_job.msg_id);
  end if;
  update public.jobs
  set status = 'queued', attempts = v_attempts, run_after = p_run_after, result = coalesce(p_result, result),
    error = case when p_kind = 'manual_retry' then null else error end,
    finished_at = null,
    msg_id = case when v_job.run_local then null else public.job_queue_send(v_job.heavy, p_job_id, p_run_after) end
  where id = p_job_id;
  insert into public.job_events (job_id, kind, from_status, to_status, attempt)
  values (p_job_id, p_kind, v_job.status, 'queued', v_attempts);
  return true;
end;
$$;

revoke execute on function public.requeue_job(uuid, text, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.requeue_job(uuid, text, timestamptz, text, jsonb) to service_role;
