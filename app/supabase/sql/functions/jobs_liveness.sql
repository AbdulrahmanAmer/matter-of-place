create or replace function public.jobs_liveness(p_now timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  -- B8b's keep-warm tick reports job_runner_stalled from these two values (JOB-04). A local job waits for the laptop
  -- by design, so it never reads as a stalled runner (ruling H34 (2)).
  select jsonb_build_object(
    'runner_beat_at', (select h.at from public.ops_heartbeats h where h.name = 'runner'),
    'oldest_due_age_s', (
      select floor(extract(epoch from p_now - min(j.run_after)))::bigint
      from public.jobs j
      where j.status in ('queued', 'failed') and not j.run_local and j.run_after <= p_now
    )
  );
$$;

revoke execute on function public.jobs_liveness(timestamptz) from public, anon, authenticated;
grant execute on function public.jobs_liveness(timestamptz) to service_role;
