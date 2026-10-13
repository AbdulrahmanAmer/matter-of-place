-- down: re-run bun run db:fn health_counts from the previous commit of supabase/sql/functions/health_counts.sql
set lock_timeout = '5s';

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
          -- A policy that never ran counts as stalled two days after it was written, not on its first day (gap 17).
          (p.last_run_at is null and p.updated_at < p_now - interval '2 days')
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
    'backup', v_backup,
    -- Gap audit item 7: public writes let in without a passed Turnstile check (Cloudflare unreachable) in 24 hours.
    'unverified_24h', (
      (select count(*) from public.submissions where not turnstile_ok and received_at > p_now - interval '24 hours')
      + (select count(*) from public.inquiries where not turnstile_ok and received_at > p_now - interval '24 hours')
      + (select count(*) from public.subject_requests where not turnstile_ok and received_at > p_now - interval '24 hours')
    ),
    -- Gap audit item 22: contact events about our own readers dropped for an unmapped audience, in 24 hours.
    'dropped_contact_events_24h', (
      select count(*) from public.audit_log
      where action = 'email.contact_event_dropped' and at > p_now - interval '24 hours'
    ),
    -- Gap audit item 29: open privacy requests due within 7 days, or past due.
    'privacy_due_7d', (
      select count(*) from public.subject_requests
      where status in ('received', 'verifying') and due_at < p_now + interval '7 days'
    ),
    -- W5 (operator and Jay, 2026-10-13): an agent key has no daily block any more, only an alert line, the
    -- requests_per_day of settings.agent_daily_limits (2,000 by default). Keys past it in the last 24 hours.
    'agent_keys_over_line', (
      select count(*) from (
        select r.bucket
        from public.rate_limits r
        where r.bucket like 'agent:%' and r.at > p_now - interval '24 hours'
        group by r.bucket
        having count(*) > coalesce(
          (select (s.value ->> 'requests_per_day')::int from public.settings s where s.key = 'agent_daily_limits'),
          2000
        )
      ) heavy
    ),
    -- W5 item 19: AI colleague runs nobody is doing. A run of an active colleague queued over 30 minutes (the laptop
    -- runner is off or paused) or running 10 minutes past its lease (a stuck run).
    'agent_runs_waiting', (
      select count(*) from public.agent_runs r
      join public.agents a on a.id = r.agent_id
      where a.state in ('idle', 'working')
        and (
          (r.state = 'queued' and r.created_at < p_now - interval '30 minutes')
          or (r.state = 'running' and r.lease_until < p_now - interval '10 minutes')
        )
    )
  );
end;
$$;

revoke execute on function public.health_counts(timestamptz) from public, anon, authenticated;
grant execute on function public.health_counts(timestamptz) to service_role;
