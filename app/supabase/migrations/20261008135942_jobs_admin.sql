-- down: drop function public.admin_retry_job(uuid, uuid, public.actor_kind, text), public.admin_cancel_job(uuid, uuid, public.actor_kind, text), public.admin_approve_job(uuid, uuid, public.actor_kind, text), public.admin_retry_jobs(uuid, public.actor_kind, text, text, text, timestamptz);
set lock_timeout = '5s';

create or replace function public.admin_retry_job(
  p_job_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.job_status;
begin
  -- Screen 16 (B8 step 9): a dead or failed job runs again from attempt 0, audited in the same transaction.
  select j.status into v_status from public.jobs j where j.id = p_job_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_status not in ('dead', 'failed') then
    raise exception 'invalid_state';
  end if;
  perform public.requeue_job(p_job_id => p_job_id, p_claim => null, p_run_after => now(), p_kind => 'manual_retry');
  perform public.write_audit(
    p_actor, p_actor_kind, 'jobs.retry', 'job', p_job_id,
    jsonb_build_object('id', p_job_id, 'status', v_status),
    jsonb_build_object('id', p_job_id, 'status', 'queued'),
    p_request_id
  );
end;
$$;

revoke execute on function public.admin_retry_job(uuid, uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.admin_retry_job(uuid, uuid, public.actor_kind, text) to service_role;

create or replace function public.admin_cancel_job(
  p_job_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.job_status;
begin
  -- Screen 16 (B8 step 9): a job that has not run yet, or waits for its next attempt, is cancelled and audited.
  select j.status into v_status from public.jobs j where j.id = p_job_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_status not in ('queued', 'failed', 'waiting_approval') then
    raise exception 'invalid_state';
  end if;
  perform public.cancel_job(p_job_id => p_job_id, p_actor_id => p_actor);
  perform public.write_audit(
    p_actor, p_actor_kind, 'jobs.cancel', 'job', p_job_id,
    jsonb_build_object('id', p_job_id, 'status', v_status),
    jsonb_build_object('id', p_job_id, 'status', 'cancelled'),
    p_request_id
  );
end;
$$;

revoke execute on function public.admin_cancel_job(uuid, uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.admin_cancel_job(uuid, uuid, public.actor_kind, text) to service_role;

create or replace function public.admin_approve_job(
  p_job_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.job_status;
begin
  -- Screen 16 (B8 step 9): the human gate of S23 and S46. `write_audit` refuses an agent, `jobs.approve` is human-only.
  select j.status into v_status from public.jobs j where j.id = p_job_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_status <> 'waiting_approval' then
    raise exception 'invalid_state';
  end if;
  perform public.approve_job(p_job_id => p_job_id, p_actor_id => p_actor);
  perform public.write_audit(
    p_actor, p_actor_kind, 'jobs.approve', 'job', p_job_id,
    jsonb_build_object('id', p_job_id, 'status', v_status),
    jsonb_build_object('id', p_job_id, 'status', 'queued'),
    p_request_id
  );
end;
$$;

revoke execute on function public.admin_approve_job(uuid, uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.admin_approve_job(uuid, uuid, public.actor_kind, text) to service_role;

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
