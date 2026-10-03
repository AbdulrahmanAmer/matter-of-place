create or replace function public.claim_job(p_job_id uuid)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.job_status;
  v_job public.jobs;
begin
  -- Invariant 2: a second claim waits on the row lock, then sees `running` and gets no row.
  select j.status into v_from
  from public.jobs j
  where j.id = p_job_id and j.status in ('queued', 'failed')
  for update;
  if not found then
    return;
  end if;
  -- JOB-02: a fresh claim token per run; attempts change only in fail_job.
  update public.jobs
  set status = 'running', locked_at = now(), locked_by = gen_random_uuid()::text
  where id = p_job_id
  returning * into v_job;
  insert into public.job_events (job_id, kind, from_status, to_status, attempt)
  values (p_job_id, 'claimed', v_from, 'running', v_job.attempts);
  return next v_job;
end;
$$;

revoke execute on function public.claim_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_job(uuid) to service_role;
