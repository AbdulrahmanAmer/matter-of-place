create or replace function public.health_cron_failures(p_since timestamptz)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  -- pg_cron's own failures only: a runner that answers 401 or 500 never shows here, ops_health covers it (DO-03).
  select count(*)::int from cron.job_run_details where status = 'failed' and start_time >= p_since;
$$;

revoke execute on function public.health_cron_failures(timestamptz) from public, anon, authenticated;
grant execute on function public.health_cron_failures(timestamptz) to service_role;
