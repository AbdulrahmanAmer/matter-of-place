create or replace function public.finish_job(
  p_job_id uuid,
  p_claim text,
  p_result jsonb default null,
  p_dispatched boolean default false,
  p_run_url text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts int;
begin
  -- JOB-02: only the run that holds the claim may finish; a late runner or callback changes nothing.
  select j.attempts into v_attempts
  from public.jobs j
  where j.id = p_job_id and j.status = 'running' and j.locked_by = p_claim
  for update;
  if not found then
    return false;
  end if;
  -- A 204 from the dispatch: the job stays running under its claim until the callback.
  if p_dispatched then
    update public.jobs set result = p_result where id = p_job_id;
    insert into public.job_events (job_id, kind, from_status, to_status, attempt)
    values (p_job_id, 'dispatched', 'running', 'running', v_attempts);
    return true;
  end if;
  if p_run_url is not null then
    insert into public.job_events (job_id, kind, from_status, to_status, attempt, data)
    values (p_job_id, 'callback', 'running', 'running', v_attempts, jsonb_build_object('run_url', p_run_url));
  end if;
  update public.jobs
  set status = 'done', result = coalesce(p_result, result), finished_at = now()
  where id = p_job_id;
  insert into public.job_events (job_id, kind, from_status, to_status, attempt)
  values (p_job_id, 'done', 'running', 'done', v_attempts);
  return true;
end;
$$;

revoke execute on function public.finish_job(uuid, text, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.finish_job(uuid, text, jsonb, boolean, text) to service_role;
