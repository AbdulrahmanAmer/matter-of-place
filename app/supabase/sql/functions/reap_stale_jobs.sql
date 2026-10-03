create or replace function public.reap_stale_jobs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_error text;
  v_lease_expired int := 0;
  v_callback_timeout int := 0;
  v_resent int := 0;
begin
  -- JOB-02: an expired lease goes through the fail path (one attempt, backoff, dead at max_attempts), never a free
  -- reset. A heavy job waits 30 minutes for its callback.
  for v_job in
    select * from public.jobs j
    where j.status = 'running'
      and j.locked_at < now() - case when j.heavy then interval '30 minutes' else interval '5 minutes' end
    for update skip locked
  loop
    v_error := case when v_job.heavy then 'callback_timeout' else 'lease_expired' end;
    insert into public.job_events (job_id, kind, from_status, to_status, attempt, message)
    values (v_job.id, 'stale', 'running', 'running', v_job.attempts, v_error);
    perform public.fail_job(v_job.id, v_job.locked_by, v_error);
    if v_job.heavy then
      v_callback_timeout := v_callback_timeout + 1;
    else
      v_lease_expired := v_lease_expired + 1;
    end if;
  end loop;
  -- Invariant 5: a runnable job whose message is gone gets a new one. A local job never has one (ruling H34 (2)).
  for v_job in
    select * from public.jobs j
    where j.status in ('queued', 'failed')
      and not j.run_local
      and j.run_after < now() - interval '5 minutes'
      and (j.msg_id is null or not exists (
        select 1 from pgmq.q_jobs_light q where not j.heavy and q.msg_id = j.msg_id
        union all
        select 1 from pgmq.q_jobs_heavy q where j.heavy and q.msg_id = j.msg_id
      ))
    for update skip locked
  loop
    update public.jobs set msg_id = public.job_queue_send(v_job.heavy, v_job.id, v_job.run_after) where id = v_job.id;
    v_resent := v_resent + 1;
  end loop;
  return jsonb_build_object(
    'lease_expired', v_lease_expired, 'callback_timeout', v_callback_timeout, 'resent', v_resent
  );
end;
$$;

revoke execute on function public.reap_stale_jobs() from public, anon, authenticated;
grant execute on function public.reap_stale_jobs() to service_role;
