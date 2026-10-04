create or replace function public.health_counts(p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_backup jsonb;
  v_last_run jsonb;
begin
  -- B8b's schedule_settings: the backup row is read once the table exists, and is null before (PERF-09, SEC-11).
  if to_regclass('public.schedule_settings') is not null then
    execute $q$
      select jsonb_build_object('enabled', enabled, 'last_run_at', last_run_at)
      from public.schedule_settings
      where key = 'backup'
    $q$ into v_backup;
  end if;
  select a.after into v_last_run
  from public.audit_log a
  where a.action = 'retention.run' and a.entity = 'retention'
  order by a.at desc, a.id desc
  limit 1;
  -- A local job waits for the laptop by design (ruling H34 (2)): it is kept out of stale_queue and long_waits and
  -- reported as local_oldest_age_s instead.
  return jsonb_build_object(
    'dead_jobs_24h', (
      select count(*) from public.jobs where status = 'dead' and finished_at > p_now - interval '24 hours'
    ),
    'stale_queue', (
      select count(*) from public.jobs
      where status = 'queued' and not run_local and run_after < p_now - interval '15 minutes'
    ),
    'retention_stalled', coalesce((
      select jsonb_agg(p.key order by p.key)
      from public.retention_policies p
      where p.enabled and p.action <> 'keep'
        and (
          p.last_run_at is null
          or p.last_run_at < p_now - interval '2 days'
          or coalesce((v_last_run -> p.key ->> 'remaining')::int, 0) > 0
        )
    ), '[]'::jsonb),
    'long_waits', (
      select count(*) from public.jobs
      where status in ('queued', 'failed') and not run_local and created_at < p_now - interval '7 days'
    ),
    'local_oldest_age_s', (
      select floor(extract(epoch from p_now - min(created_at)))::bigint
      from public.jobs
      where run_local and status in ('queued', 'failed')
    ),
    'backup', v_backup
  );
end;
$$;

revoke execute on function public.health_counts(timestamptz) from public, anon, authenticated;
grant execute on function public.health_counts(timestamptz) to service_role;
