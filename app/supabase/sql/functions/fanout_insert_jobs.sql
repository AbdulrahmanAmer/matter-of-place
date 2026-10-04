create or replace function public.fanout_insert_jobs(p_event_id uuid, p_jobs jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_processed_at timestamptz;
  v_job jsonb;
  v_count int := 0;
begin
  -- JOB-07: the event row is the lock, so two sweeps of one event insert its jobs once.
  select e.processed_at into v_processed_at from public.events e where e.id = p_event_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_processed_at is not null then
    return 0;
  end if;
  -- B8's enqueue_job is the only writer of jobs and job_events (architecture 3.6); a key that exists returns null.
  for v_job in select j.value from jsonb_array_elements(p_jobs) as j loop
    if public.enqueue_job(
      v_job ->> 'type',
      v_job -> 'payload',
      v_job ->> 'idempotency_key',
      coalesce((v_job ->> 'heavy')::boolean, false),
      (v_job ->> 'status')::public.job_status,
      now(),
      p_event_id,
      (v_job ->> 'recipe_id')::uuid,
      v_job ->> 'step_id',
      p_max_attempts => coalesce((v_job ->> 'max_attempts')::int, 5),
      p_local => coalesce((v_job ->> 'run_local')::boolean, false)
    ) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  update public.events set processed_at = now() where id = p_event_id;
  delete from public.event_fanout_failures where event_id = p_event_id;
  return v_count;
end;
$$;

revoke execute on function public.fanout_insert_jobs(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fanout_insert_jobs(uuid, jsonb) to service_role;
