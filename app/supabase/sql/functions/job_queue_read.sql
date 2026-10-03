create or replace function public.job_queue_read(p_heavy boolean, p_vt int, p_qty int)
returns table (msg_id bigint, read_ct int, job_id uuid)
language sql
security definer
set search_path = ''
as $$
  select m.msg_id, m.read_ct, (m.message ->> 'job_id')::uuid
  from pgmq.read(case when p_heavy then 'jobs_heavy' else 'jobs_light' end, p_vt, p_qty) m
$$;

revoke execute on function public.job_queue_read(boolean, int, int) from public, anon, authenticated;
grant execute on function public.job_queue_read(boolean, int, int) to service_role;
