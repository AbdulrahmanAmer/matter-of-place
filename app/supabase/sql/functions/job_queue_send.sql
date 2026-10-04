create or replace function public.job_queue_send(p_heavy boolean, p_job_id uuid, p_run_after timestamptz)
returns bigint
language sql
security definer
set search_path = ''
as $$
  -- A wake-up for the job runner, visible from run_after on; the jobs row stays the truth (invariant 5).
  select pgmq.send(
    case when p_heavy then 'jobs_heavy' else 'jobs_light' end,
    jsonb_build_object('job_id', p_job_id),
    greatest(0, extract(epoch from p_run_after - now()))::int
  )
$$;

revoke execute on function public.job_queue_send(boolean, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.job_queue_send(boolean, uuid, timestamptz) to service_role;
