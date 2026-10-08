create or replace function public.admin_retry_jobs(
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_type text default null,
  p_error_like text default null,
  p_since timestamptz default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count int := 0;
begin
  -- Screen 16's "Retry all matching" (E2E-03): every dead job that matches each filter given, one audit row for all.
  -- The filters default to null and follow the actor (P-915). `jobs_status_run_after_idx` serves `status = 'dead'`.
  for v_id in
    select j.id
    from public.jobs j
    where j.status = 'dead'
      and (p_type is null or j.type = p_type)
      and (p_error_like is null or j.error ilike p_error_like)
      and (p_since is null or j.finished_at >= p_since)
    order by j.created_at, j.id
    for update
  loop
    if public.requeue_job(p_job_id => v_id, p_claim => null, p_run_after => now(), p_kind => 'manual_retry') then
      v_count := v_count + 1;
    end if;
  end loop;
  perform public.write_audit(
    p_actor, p_actor_kind, 'jobs.retry_bulk', 'job', null, null,
    jsonb_build_object('count', v_count, 'type', p_type, 'error_like', p_error_like, 'since', p_since),
    p_request_id
  );
  return v_count;
end;
$$;

revoke execute on function public.admin_retry_jobs(uuid, public.actor_kind, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_retry_jobs(uuid, public.actor_kind, text, text, text, timestamptz)
  to service_role;
