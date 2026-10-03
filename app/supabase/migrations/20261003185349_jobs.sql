-- down:
--   drop function public.reap_stale_jobs(), public.approve_job(uuid, uuid), public.cancel_job(uuid, uuid, text),
--     public.requeue_job(uuid, text, timestamptz, text, jsonb), public.fail_job(uuid, text, text, boolean, text),
--     public.finish_job(uuid, text, jsonb, boolean, text), public.claim_job(uuid),
--     public.enqueue_job_manual(text, uuid, jsonb, int),
--     public.enqueue_job(text, jsonb, text, boolean, public.job_status, timestamptz, uuid, uuid, text, int, boolean),
--     public.job_event_entity_id(public.jobs), public.emit_event(text, text, uuid, jsonb, uuid),
--     public.job_queue_delete(boolean, bigint), public.job_queue_read(boolean, int, int),
--     public.job_queue_send(boolean, uuid, timestamptz);
--   drop table public.job_events, public.jobs, public.events;
--   drop function public.job_events_append_only(), public.events_append_only();
--   drop type public.job_status;
--   select pgmq.drop_queue('jobs_light'); select pgmq.drop_queue('jobs_heavy');
--   pgmq and pg_net stay installed.
set lock_timeout = '5s';

-- Supabase free extensions (invariant 8). `if not exists` and the idempotent pgmq.create let the file re-apply after
-- db:reset, which empties `public` and drops the queues but keeps extensions.
create extension if not exists pgmq;
create extension if not exists pg_net with schema extensions;

select pgmq.create('jobs_light');
select pgmq.create('jobs_heavy');

create type public.job_status as enum (
  'queued', 'running', 'done', 'failed', 'dead', 'waiting_approval', 'cancelled'
);

-- The event catalog of architecture 3.6, the same list as CatalogEventType in src/server/lib/events.ts.
create table public.events (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in (
    'submission.received', 'submission.declined', 'submission.accepted', 'submission.awaiting_assets',
    'invoice.issued', 'payment.marked', 'submission.activated', 'property.published', 'property.unpublished',
    'asset.approved', 'asset.rejected', 'digest.due', 'inquiry.received', 'subscriber.created',
    'subscriber.confirmed', 'invoice.voided', 'health.failed', 'subject_request.received'
  )),
  entity text,
  entity_id uuid,
  payload jsonb not null default '{}',
  actor_id uuid,
  at timestamptz not null default now(),
  processed_at timestamptz
);
create index events_unprocessed_idx on public.events (processed_at) where processed_at is null;

-- recipe_id gets its foreign key in B8b's migration, which creates automation_recipes.
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}',
  idempotency_key text not null unique,
  status public.job_status not null default 'queued',
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 5 check (max_attempts > 0),
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  heavy boolean not null default false,
  run_local boolean not null default false,
  recipe_id uuid,
  step_id text,
  event_id uuid references public.events (id) on delete restrict,
  result jsonb,
  error text,
  msg_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create trigger jobs_set_updated_at
before update on public.jobs
for each row execute function public.set_updated_at();
create index jobs_status_run_after_idx on public.jobs (status, run_after);
create index jobs_type_created_idx on public.jobs (type, created_at desc);
create index jobs_event_idx on public.jobs (event_id);
-- Screen 16's keyset list (B7 invariant 17c).
create index jobs_admin_list_idx on public.jobs (created_at desc, id desc);
create index jobs_admin_status_list_idx on public.jobs (status, created_at desc, id desc);
-- Ruling H34 (2): the laptop runner's read and health_counts.
create index jobs_local_waiting_idx on public.jobs (created_at) where run_local and status in ('queued', 'failed');

create table public.job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs (id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in (
    'created', 'claimed', 'done', 'failed', 'dead', 'dispatched', 'callback', 'approved', 'cancelled',
    'manual_retry', 'requeued', 'stale'
  )),
  from_status public.job_status,
  to_status public.job_status,
  attempt int,
  message text,
  data jsonb,
  actor_id uuid
);
create index job_events_job_idx on public.job_events (job_id, at);

-- Architecture 3.7: every staff role reads; nobody writes through the API, only through the functions below.
alter table public.events enable row level security;
alter table public.jobs enable row level security;
alter table public.job_events enable row level security;
revoke all on table public.events, public.jobs, public.job_events from anon, authenticated;
grant select on table public.events, public.jobs, public.job_events to authenticated;
grant all on table public.events, public.jobs, public.job_events to service_role;
create policy events_select_staff on public.events for select to authenticated using (app.is_staff());
create policy jobs_select_staff on public.jobs for select to authenticated using (app.is_staff());
create policy job_events_select_staff on public.job_events for select to authenticated using (app.is_staff());

create or replace function public.events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- G16: only the retention job deletes, inside its own transaction.
  if tg_op = 'DELETE' then
    if current_setting('mop.retention', true) = 'on' then
      return old;
    end if;
    raise exception 'append_only';
  end if;
  -- B8b's fan-out marks an event processed once; nothing else of an event ever changes.
  if old.processed_at is null and new.processed_at is not null
    and to_jsonb(new) - 'processed_at' = to_jsonb(old) - 'processed_at' then
    return new;
  end if;
  raise exception 'append_only';
end;
$$;

revoke execute on function public.events_append_only() from public, anon, authenticated;

create or replace function public.job_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only prune_jobs and the retention job delete, inside their own transaction (G16).
  if tg_op = 'DELETE' and current_setting('mop.retention', true) = 'on' then
    return old;
  end if;
  raise exception 'append_only';
end;
$$;

revoke execute on function public.job_events_append_only() from public, anon, authenticated;

create or replace function public.job_queue_send(p_heavy boolean, p_job_id uuid, p_run_after timestamptz)
returns bigint
language sql
security definer
set search_path = ''
as $$
  -- A wake-up for the job runner, visible from run_after on; the jobs row stays the truth (invariant 5).
  select pgmq.send(
    case when p_heavy then 'jobs_heavy' else 'jobs_light' end,
    jsonb_build_object('job_id', p_job_id),
    greatest(0, extract(epoch from p_run_after - now()))::int
  )
$$;

revoke execute on function public.job_queue_send(boolean, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.job_queue_send(boolean, uuid, timestamptz) to service_role;

create or replace function public.job_queue_read(p_heavy boolean, p_vt int, p_qty int)
returns table (msg_id bigint, read_ct int, job_id uuid)
language sql
security definer
set search_path = ''
as $$
  select m.msg_id, m.read_ct, (m.message ->> 'job_id')::uuid
  from pgmq.read(case when p_heavy then 'jobs_heavy' else 'jobs_light' end, p_vt, p_qty) m
$$;

revoke execute on function public.job_queue_read(boolean, int, int) from public, anon, authenticated;
grant execute on function public.job_queue_read(boolean, int, int) to service_role;

create or replace function public.job_queue_delete(p_heavy boolean, p_msg_id bigint)
returns boolean
language sql
security definer
set search_path = ''
as $$
  -- Nothing is archived: job_events is the record (JOB-10).
  select pgmq.delete(case when p_heavy then 'jobs_heavy' else 'jobs_light' end, p_msg_id)
$$;

revoke execute on function public.job_queue_delete(boolean, bigint) from public, anon, authenticated;
grant execute on function public.job_queue_delete(boolean, bigint) to service_role;

create or replace function public.emit_event(
  p_type text,
  p_entity text,
  p_entity_id uuid,
  p_payload jsonb,
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

create or replace function public.job_event_entity_id(j public.jobs)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- G64: a PostgREST computed field, so one `or` filter finds an entity's jobs through their event.
  select e.entity_id from public.events e where e.id = j.event_id
$$;

revoke execute on function public.job_event_entity_id(public.jobs) from public, anon, authenticated;
grant execute on function public.job_event_entity_id(public.jobs) to service_role;

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

create or replace function public.enqueue_job_manual(
  p_type text,
  p_entity_id uuid,
  p_payload jsonb,
  p_max_attempts int default 5
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text := p_type || ':' || p_entity_id::text || ':';
  v_n int;
begin
  perform pg_advisory_xact_lock(hashtext(p_type || p_entity_id::text));
  -- DB-09: the largest number plus one, never a count, so a pruned key is never handed out again. Only a numeric
  -- third part counts, so a free-form key with the same prefix cannot break the cast.
  select 1 + coalesce(
    max(split_part(j.idempotency_key, ':', 3)::int) filter (where split_part(j.idempotency_key, ':', 3) ~ '^[0-9]+$'),
    0
  )
  into v_n
  from public.jobs j
  where starts_with(j.idempotency_key, v_prefix);
  return public.enqueue_job(p_type, p_payload, v_prefix || v_n::text, p_max_attempts => p_max_attempts);
end;
$$;

revoke execute on function public.enqueue_job_manual(text, uuid, jsonb, int) from public, anon, authenticated;
grant execute on function public.enqueue_job_manual(text, uuid, jsonb, int) to service_role;

create or replace function public.claim_job(p_job_id uuid)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.job_status;
  v_job public.jobs;
begin
  -- Invariant 2: a second claim waits on the row lock, then sees `running` and gets no row.
  select j.status into v_from
  from public.jobs j
  where j.id = p_job_id and j.status in ('queued', 'failed')
  for update;
  if not found then
    return;
  end if;
  -- JOB-02: a fresh claim token per run; attempts change only in fail_job.
  update public.jobs
  set status = 'running', locked_at = now(), locked_by = gen_random_uuid()::text
  where id = p_job_id
  returning * into v_job;
  insert into public.job_events (job_id, kind, from_status, to_status, attempt)
  values (p_job_id, 'claimed', v_from, 'running', v_job.attempts);
  return next v_job;
end;
$$;

revoke execute on function public.claim_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_job(uuid) to service_role;

create or replace function public.finish_job(
  p_job_id uuid,
  p_claim text,
  p_result jsonb default null,
  p_dispatched boolean default false,
  p_run_url text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts int;
begin
  -- JOB-02: only the run that holds the claim may finish; a late runner or callback changes nothing.
  select j.attempts into v_attempts
  from public.jobs j
  where j.id = p_job_id and j.status = 'running' and j.locked_by = p_claim
  for update;
  if not found then
    return false;
  end if;
  -- A 204 from the dispatch: the job stays running under its claim until the callback.
  if p_dispatched then
    update public.jobs set result = p_result where id = p_job_id;
    insert into public.job_events (job_id, kind, from_status, to_status, attempt)
    values (p_job_id, 'dispatched', 'running', 'running', v_attempts);
    return true;
  end if;
  if p_run_url is not null then
    insert into public.job_events (job_id, kind, from_status, to_status, attempt, data)
    values (p_job_id, 'callback', 'running', 'running', v_attempts, jsonb_build_object('run_url', p_run_url));
  end if;
  update public.jobs
  set status = 'done', result = coalesce(p_result, result), finished_at = now()
  where id = p_job_id;
  insert into public.job_events (job_id, kind, from_status, to_status, attempt)
  values (p_job_id, 'done', 'running', 'done', v_attempts);
  return true;
end;
$$;

revoke execute on function public.finish_job(uuid, text, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.finish_job(uuid, text, jsonb, boolean, text) to service_role;

create or replace function public.fail_job(
  p_job_id uuid,
  p_claim text,
  p_error text,
  p_dead boolean default false,
  p_run_url text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_attempts int;
  v_run_after timestamptz;
begin
  -- JOB-02: only the run that holds the claim may fail the job; the reaper passes the job's own claim.
  select * into v_job
  from public.jobs j
  where j.id = p_job_id and j.status = 'running' and j.locked_by = p_claim
  for update;
  if not found then
    return false;
  end if;
  if p_run_url is not null then
    insert into public.job_events (job_id, kind, from_status, to_status, attempt, data)
    values (p_job_id, 'callback', 'running', 'running', v_job.attempts, jsonb_build_object('run_url', p_run_url));
  end if;
  -- Invariant 2: the one place an attempt is used.
  v_attempts := v_job.attempts + 1;
  if p_dead or v_attempts >= v_job.max_attempts then
    update public.jobs
    set status = 'dead', attempts = v_attempts, error = p_error, finished_at = now()
    where id = p_job_id;
    insert into public.job_events (job_id, kind, from_status, to_status, attempt, message)
    values (p_job_id, 'dead', 'running', 'dead', v_attempts, p_error);
    return true;
  end if;
  -- Invariant 4: min(30 s * 2^(attempts - 1), 1 h), plus or minus 20 percent.
  v_run_after := now() + make_interval(secs => least(30 * power(2, v_attempts - 1), 3600) * (0.8 + 0.4 * random()));
  if v_job.msg_id is not null then
    perform public.job_queue_delete(v_job.heavy, v_job.msg_id);
  end if;
  update public.jobs
  set status = 'failed', attempts = v_attempts, error = p_error, run_after = v_run_after,
    msg_id = case when v_job.run_local then null else public.job_queue_send(v_job.heavy, p_job_id, v_run_after) end
  where id = p_job_id;
  insert into public.job_events (job_id, kind, from_status, to_status, attempt, message)
  values (p_job_id, 'failed', 'running', 'failed', v_attempts, p_error);
  return true;
end;
$$;

revoke execute on function public.fail_job(uuid, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.fail_job(uuid, text, text, boolean, text) to service_role;

create or replace function public.requeue_job(
  p_job_id uuid,
  p_claim text,
  p_run_after timestamptz,
  p_kind text,
  p_result jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_attempts int;
begin
  if p_kind = 'requeued' then
    -- A step's retry_at or a runner wait: only under the run's claim, and no attempt is used (invariant 3).
    select * into v_job
    from public.jobs j
    where j.id = p_job_id and j.status = 'running' and j.locked_by = p_claim
    for update;
  elsif p_kind = 'manual_retry' then
    select * into v_job
    from public.jobs j
    where j.id = p_job_id and j.status in ('dead', 'failed')
    for update;
  else
    raise exception 'invalid_kind';
  end if;
  if not found then
    return false;
  end if;
  v_attempts := case when p_kind = 'manual_retry' then 0 else v_job.attempts end;
  if v_job.msg_id is not null then
    perform public.job_queue_delete(v_job.heavy, v_job.msg_id);
  end if;
  update public.jobs
  set status = 'queued', attempts = v_attempts, run_after = p_run_after, result = coalesce(p_result, result),
    error = case when p_kind = 'manual_retry' then null else error end,
    finished_at = null,
    msg_id = case when v_job.run_local then null else public.job_queue_send(v_job.heavy, p_job_id, p_run_after) end
  where id = p_job_id;
  insert into public.job_events (job_id, kind, from_status, to_status, attempt)
  values (p_job_id, p_kind, v_job.status, 'queued', v_attempts);
  return true;
end;
$$;

revoke execute on function public.requeue_job(uuid, text, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.requeue_job(uuid, text, timestamptz, text, jsonb) to service_role;

create or replace function public.cancel_job(p_job_id uuid, p_actor_id uuid default null, p_message text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  select * into v_job
  from public.jobs j
  where j.id = p_job_id and j.status in ('queued', 'failed', 'waiting_approval')
  for update;
  if not found then
    return false;
  end if;
  if v_job.msg_id is not null then
    perform public.job_queue_delete(v_job.heavy, v_job.msg_id);
  end if;
  update public.jobs set status = 'cancelled', finished_at = now(), msg_id = null where id = p_job_id;
  insert into public.job_events (job_id, kind, from_status, to_status, attempt, message, actor_id)
  values (p_job_id, 'cancelled', v_job.status, 'cancelled', v_job.attempts, p_message, p_actor_id);
  return true;
end;
$$;

revoke execute on function public.cancel_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_job(uuid, uuid, text) to service_role;

create or replace function public.approve_job(p_job_id uuid, p_actor_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  select * into v_job
  from public.jobs j
  where j.id = p_job_id and j.status = 'waiting_approval'
  for update;
  if not found then
    return false;
  end if;
  update public.jobs
  set status = 'queued',
    msg_id = case when v_job.run_local then null else public.job_queue_send(v_job.heavy, p_job_id, v_job.run_after) end
  where id = p_job_id;
  insert into public.job_events (job_id, kind, from_status, to_status, attempt, actor_id)
  values (p_job_id, 'approved', 'waiting_approval', 'queued', v_job.attempts, p_actor_id);
  return true;
end;
$$;

revoke execute on function public.approve_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_job(uuid, uuid) to service_role;

create or replace function public.reap_stale_jobs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_error text;
  v_lease_expired int := 0;
  v_callback_timeout int := 0;
  v_resent int := 0;
begin
  -- JOB-02: an expired lease goes through the fail path (one attempt, backoff, dead at max_attempts), never a free
  -- reset. A heavy job waits 30 minutes for its callback.
  for v_job in
    select * from public.jobs j
    where j.status = 'running'
      and j.locked_at < now() - case when j.heavy then interval '30 minutes' else interval '5 minutes' end
    for update skip locked
  loop
    v_error := case when v_job.heavy then 'callback_timeout' else 'lease_expired' end;
    insert into public.job_events (job_id, kind, from_status, to_status, attempt, message)
    values (v_job.id, 'stale', 'running', 'running', v_job.attempts, v_error);
    perform public.fail_job(v_job.id, v_job.locked_by, v_error);
    if v_job.heavy then
      v_callback_timeout := v_callback_timeout + 1;
    else
      v_lease_expired := v_lease_expired + 1;
    end if;
  end loop;
  -- Invariant 5: a runnable job whose message is gone gets a new one. A local job never has one (ruling H34 (2)).
  for v_job in
    select * from public.jobs j
    where j.status in ('queued', 'failed')
      and not j.run_local
      and j.run_after < now() - interval '5 minutes'
      and (j.msg_id is null or not exists (
        select 1 from pgmq.q_jobs_light q where not j.heavy and q.msg_id = j.msg_id
        union all
        select 1 from pgmq.q_jobs_heavy q where j.heavy and q.msg_id = j.msg_id
      ))
    for update skip locked
  loop
    update public.jobs set msg_id = public.job_queue_send(v_job.heavy, v_job.id, v_job.run_after) where id = v_job.id;
    v_resent := v_resent + 1;
  end loop;
  return jsonb_build_object(
    'lease_expired', v_lease_expired, 'callback_timeout', v_callback_timeout, 'resent', v_resent
  );
end;
$$;

revoke execute on function public.reap_stale_jobs() from public, anon, authenticated;
grant execute on function public.reap_stale_jobs() to service_role;

create trigger events_append_only
before update or delete on public.events
for each row execute function public.events_append_only();

create trigger job_events_append_only
before update or delete on public.job_events
for each row execute function public.job_events_append_only();
