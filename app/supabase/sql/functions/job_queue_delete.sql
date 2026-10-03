create or replace function public.job_queue_delete(p_heavy boolean, p_msg_id bigint)
returns boolean
language sql
security definer
set search_path = ''
as $$
  -- Nothing is archived: job_events is the record (JOB-10).
  select pgmq.delete(case when p_heavy then 'jobs_heavy' else 'jobs_light' end, p_msg_id)
$$;

revoke execute on function public.job_queue_delete(boolean, bigint) from public, anon, authenticated;
grant execute on function public.job_queue_delete(boolean, bigint) to service_role;
