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
