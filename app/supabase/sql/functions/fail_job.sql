create or replace function public.fail_job(
  p_job_id uuid,
  p_claim text,
  p_error text,
  p_dead boolean default false,
  p_run_url text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_attempts int;
  v_run_after timestamptz;
begin
  -- JOB-02: only the run that holds the claim may fail the job; the reaper passes the job's own claim.
  select * into v_job
  from public.jobs j
  where j.id = p_job_id and j.status = 'running' and j.locked_by = p_claim
  for update;
  if not found then
    return false;
  end if;
  if p_run_url is not null then
    insert into public.job_events (job_id, kind, from_status, to_status, attempt, data)
    values (p_job_id, 'callback', 'running', 'running', v_job.attempts, jsonb_build_object('run_url', p_run_url));
  end if;
  -- Invariant 2: the one place an attempt is used.
  v_attempts := v_job.attempts + 1;
  if p_dead or v_attempts >= v_job.max_attempts then
    update public.jobs
    set status = 'dead', attempts = v_attempts, error = p_error, finished_at = now()
    where id = p_job_id;
    insert into public.job_events (job_id, kind, from_status, to_status, attempt, message)
    values (p_job_id, 'dead', 'running', 'dead', v_attempts, p_error);
    return true;
  end if;
  -- Invariant 4: min(30 s * 2^(attempts - 1), 1 h), plus or minus 20 percent.
  v_run_after := now() + make_interval(secs => least(30 * power(2, v_attempts - 1), 3600) * (0.8 + 0.4 * random()));
  if v_job.msg_id is not null then
    perform public.job_queue_delete(v_job.heavy, v_job.msg_id);
  end if;
  update public.jobs
  set status = 'failed', attempts = v_attempts, error = p_error, run_after = v_run_after,
    msg_id = case when v_job.run_local then null else public.job_queue_send(v_job.heavy, p_job_id, v_run_after) end
  where id = p_job_id;
  insert into public.job_events (job_id, kind, from_status, to_status, attempt, message)
  values (p_job_id, 'failed', 'running', 'failed', v_attempts, p_error);
  return true;
end;
$$;

revoke execute on function public.fail_job(uuid, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.fail_job(uuid, text, text, boolean, text) to service_role;
