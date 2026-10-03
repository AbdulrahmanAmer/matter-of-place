create or replace function public.enqueue_job(
  p_type text,
  p_payload jsonb,
  p_idempotency_key text,
  p_heavy boolean default false,
  p_status public.job_status default 'queued',
  p_run_after timestamptz default now(),
  p_event_id uuid default null,
  p_recipe_id uuid default null,
  p_step_id text default null,
  p_max_attempts int default 5,
  p_local boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- Invariant 1: a second insert of a key never creates a second job, and the caller gets null.
  insert into public.jobs (
    type, payload, idempotency_key, heavy, status, run_after, event_id, recipe_id, step_id, max_attempts, run_local
  ) values (
    p_type, coalesce(p_payload, '{}'::jsonb), p_idempotency_key, p_heavy, p_status, p_run_after, p_event_id,
    p_recipe_id, p_step_id, p_max_attempts, p_local
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then
    return null;
  end if;
  insert into public.job_events (job_id, kind, to_status, attempt) values (v_id, 'created', p_status, 0);
  -- Ruling H34 (2): a local job never gets a message; the laptop runner finds it by reading jobs.
  if p_status = 'queued' and not p_local then
    update public.jobs set msg_id = public.job_queue_send(p_heavy, v_id, p_run_after) where id = v_id;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.enqueue_job(
  text, jsonb, text, boolean, public.job_status, timestamptz, uuid, uuid, text, int, boolean
) from public, anon, authenticated;
grant execute on function public.enqueue_job(
  text, jsonb, text, boolean, public.job_status, timestamptz, uuid, uuid, text, int, boolean
) to service_role;
