-- down:
--   select cron.unschedule('health'); select cron.unschedule('prune');
--   drop function public.health_counts(timestamptz), public.health_cron_failures(timestamptz),
--     public.retention_delete_rows(text, boolean), public.prune_jobs(interval, boolean);
--   delete from public.retention_policies where key = 'jobs_done';
--   emit_event: re-apply 20261003185349_jobs.sql's text without the two defaults (drop and create, as defaults cannot be removed).
--   alter table public.retention_policies drop column last_count, drop column last_run_at;
set lock_timeout = '5s';

-- B8 step 8: the daily system jobs health and prune (architecture 13 rule 8). B2 owns retention_policies and its rows;
-- the retention functions record each run on the row they ran, and the health check reads those two columns.
alter table public.retention_policies
  add column if not exists last_run_at timestamptz,
  add column if not exists last_count int;

-- G43: the slice that creates jobs seeds its row; on conflict keeps an edited row.
insert into public.retention_policies (key, table_name, keep_for, action, note)
values ('jobs_done', 'jobs', interval '30 days', 'delete', 'Done and cancelled jobs after finished_at, with their job_events.')
on conflict (key) do nothing;

-- The function texts below are copied verbatim from supabase/sql/functions/<name>.sql (DB-13).
-- emit_event gains defaults for p_entity_id and p_payload, so the health job emits health.failed with no entity id
-- (a caller that passes every argument is unaffected; the body is unchanged).
create or replace function public.emit_event(
  p_type text,
  p_entity text,
  p_entity_id uuid default null,
  p_payload jsonb default '{}',
  p_actor_id uuid default null
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  -- A type outside the catalog fails the check constraint, so the caller's write rolls back with it.
  insert into public.events (type, entity, entity_id, payload, actor_id)
  values (p_type, p_entity, p_entity_id, coalesce(p_payload, '{}'::jsonb), p_actor_id)
  returning id
$$;

revoke execute on function public.emit_event(text, text, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.emit_event(text, text, uuid, jsonb, uuid) to service_role;

create or replace function public.prune_jobs(p_keep interval, p_dry_run boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  -- Architecture 13 rule 8: done and cancelled jobs go after p_keep, the keep_for of the jobs_done row, and their
  -- job_events go with them by the foreign key's cascade.
  if p_dry_run then
    select count(*)::int into v_count
    from public.jobs
    where status in ('done', 'cancelled') and finished_at < now() - p_keep;
    return v_count;
  end if;
  perform set_config('mop.retention', 'on', true);
  with gone as (
    delete from public.jobs
    where status in ('done', 'cancelled') and finished_at < now() - p_keep
    returning 1
  )
  select count(*)::int into v_count from gone;
  perform set_config('mop.retention', 'off', true);
  update public.retention_policies set last_run_at = now(), last_count = v_count where key = 'jobs_done';
  return v_count;
end;
$$;

revoke execute on function public.prune_jobs(interval, boolean) from public, anon, authenticated;
grant execute on function public.prune_jobs(interval, boolean) to service_role;

create or replace function public.retention_delete_rows(p_key text, p_dry_run boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows text;
  v_keep interval;
  v_count int;
begin
  -- GD-03: the allow-list of plain row deletes, each with its table and filter; any other key raises, so a kept table
  -- such as audit_log can never be named here. $1 is the policy row's keep_for.
  v_rows := case p_key
    when 'rate_limits' then 'public.rate_limits where at < now() - $1'
    when 'webhook_receipts' then 'public.webhook_receipts where received_at < now() - $1'
    when 'subject_requests' then
      $r$public.subject_requests where status in ('fulfilled', 'rejected') and received_at < now() - $1$r$
  end;
  if v_rows is null then
    raise exception 'bad_request';
  end if;
  select keep_for into v_keep
  from public.retention_policies
  where key = p_key and enabled and keep_for is not null;
  if not found then
    return 0;
  end if;
  if p_dry_run then
    execute 'select count(*)::int from ' || v_rows into v_count using v_keep;
    return v_count;
  end if;
  perform set_config('mop.retention', 'on', true);
  execute 'with gone as (delete from ' || v_rows || ' returning 1) select count(*)::int from gone'
    into v_count using v_keep;
  perform set_config('mop.retention', 'off', true);
  update public.retention_policies set last_run_at = now(), last_count = v_count where key = p_key;
  return v_count;
end;
$$;

revoke execute on function public.retention_delete_rows(text, boolean) from public, anon, authenticated;
grant execute on function public.retention_delete_rows(text, boolean) to service_role;

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

-- Daily system jobs keyed `<type>:<UTC date>` (invariant 1), so a second tick the same day enqueues nothing. Unscheduling
-- by name first lets the file re-apply after db:reset (F16). Reconciliation has no row here: B8b's reconcile schedule
-- starts it (G10).
select cron.unschedule('health') where exists (select 1 from cron.job where jobname = 'health');
select cron.schedule(
  'health',
  '0 13 * * *',
  $$select public.enqueue_job('health', '{"params": {}, "data": {}}'::jsonb,
    'health:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'))$$
);

select cron.unschedule('prune') where exists (select 1 from cron.job where jobname = 'prune');
select cron.schedule(
  'prune',
  '30 3 * * *',
  $$select public.enqueue_job('prune', '{"params": {}, "data": {}}'::jsonb,
    'prune:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'))$$
);
