create or replace function public.cancel_job(p_job_id uuid, p_actor_id uuid default null, p_message text default null)
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
  where j.id = p_job_id and j.status in ('queued', 'failed', 'waiting_approval')
  for update;
  if not found then
    return false;
  end if;
  if v_job.msg_id is not null then
    perform public.job_queue_delete(v_job.heavy, v_job.msg_id);
  end if;
  update public.jobs set status = 'cancelled', finished_at = now(), msg_id = null where id = p_job_id;
  insert into public.job_events (job_id, kind, from_status, to_status, attempt, message, actor_id)
  values (p_job_id, 'cancelled', v_job.status, 'cancelled', v_job.attempts, p_message, p_actor_id);
  return true;
end;
$$;

revoke execute on function public.cancel_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_job(uuid, uuid, text) to service_role;
