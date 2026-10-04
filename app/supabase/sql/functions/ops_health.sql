create or replace function public.ops_health(p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_failing text[] := '{}';
  v_keepwarm boolean := false;
  v_backup boolean := false;
begin
  -- DO-03, JOB-04: a runner the cron cannot reach never beats, so a stale row covers a 401, a 500 and a paused project.
  if not exists (
    select 1 from public.ops_heartbeats where name = 'runner' and at >= p_now - interval '3 minutes'
  ) then
    v_failing := array_append(v_failing, 'runner');
  end if;
  -- B8b's schedule_settings: keepwarm and backup are watched only while their row is enabled, and not before it exists.
  if to_regclass('public.schedule_settings') is not null then
    execute $q$
      select coalesce(bool_or(enabled) filter (where key = 'keepwarm'), false),
        coalesce(bool_or(enabled) filter (where key = 'backup'), false)
      from public.schedule_settings
    $q$ into v_keepwarm, v_backup;
  end if;
  if v_keepwarm and not exists (
    select 1 from public.ops_heartbeats where name = 'keepwarm' and at >= p_now - interval '25 minutes'
  ) then
    v_failing := array_append(v_failing, 'keepwarm');
  end if;
  if v_backup and not exists (
    select 1 from public.ops_heartbeats where name = 'backup' and at >= p_now - interval '26 hours'
  ) then
    v_failing := array_append(v_failing, 'backup');
  end if;
  -- A local job waits for the laptop by design (ruling H34 (2)); captions_waiting watches it instead.
  if exists (
    select 1 from public.jobs
    where status = 'queued' and not run_local and run_after < p_now - interval '15 minutes'
  ) then
    v_failing := array_append(v_failing, 'stale_queue');
  end if;
  if exists (
    select 1 from public.jobs
    where status = 'dead' and finished_at > p_now - interval '24 hours'
  ) then
    v_failing := array_append(v_failing, 'dead_jobs');
  end if;
  return jsonb_build_object('ok', cardinality(v_failing) = 0, 'failing', to_jsonb(v_failing));
end;
$$;

revoke execute on function public.ops_health(timestamptz) from public, anon, authenticated;
grant execute on function public.ops_health(timestamptz) to service_role;
