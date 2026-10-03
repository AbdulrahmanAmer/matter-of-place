create or replace function public.approve_job(p_job_id uuid, p_actor_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  select * into v_job
  from public.jobs j
  where j.id = p_job_id and j.status = 'waiting_approval'
  for update;
  if not found then
    return false;
  end if;
  update public.jobs
  set status = 'queued',
    msg_id = case when v_job.run_local then null else public.job_queue_send(v_job.heavy, p_job_id, v_job.run_after) end
  where id = p_job_id;
  insert into public.job_events (job_id, kind, from_status, to_status, attempt, actor_id)
  values (p_job_id, 'approved', 'waiting_approval', 'queued', v_job.attempts, p_actor_id);
  return true;
end;
$$;

revoke execute on function public.approve_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_job(uuid, uuid) to service_role;
