-- Stand-ins for what Supabase provides, so the migrations apply on a throwaway native PostgreSQL 18 cluster (S50, no
-- Docker): the three API roles and the `auth`, `cron`, `pgmq`, `vault`, `net` and `storage` schemas with only the
-- names and shapes the migrations read. Nothing here behaves like the real extension: a queue is a table, the
-- scheduler records a row and runs nothing. Used by `scripts/harden/migration-rollback-drill.sh`, run once on an
-- empty cluster as `psql -v ON_ERROR_STOP=1 -f scripts/harden/pg-shims.sql`.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end
$$;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists cron;
create schema if not exists pgmq;
create schema if not exists vault;
create schema if not exists net;
create schema if not exists storage;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  last_sign_in_at timestamptz
);

create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table cron.job (
  jobid bigserial primary key,
  schedule text not null,
  command text not null,
  jobname text unique
);

create table cron.job_run_details (
  runid bigserial primary key,
  jobid bigint,
  status text,
  return_message text,
  start_time timestamptz,
  end_time timestamptz
);

create function cron.schedule(job_name text, schedule text, command text) returns bigint
language sql
as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;

create function cron.unschedule(job_name text) returns boolean
language sql
as $$ with gone as (delete from cron.job where jobname = job_name returning 1) select exists (select 1 from gone) $$;

create type pgmq.message_record as (
  msg_id bigint,
  read_ct integer,
  enqueued_at timestamptz,
  vt timestamptz,
  message jsonb
);

create function pgmq.create(queue_name text) returns void
language plpgsql
as $$
begin
  execute format(
    'create table if not exists pgmq.%I (
       msg_id bigserial primary key, read_ct integer not null default 0,
       enqueued_at timestamptz not null default now(), vt timestamptz not null default now(), message jsonb)',
    'q_' || queue_name
  );
end
$$;

create function pgmq.send(queue_name text, msg jsonb, delay integer default 0) returns setof bigint
language plpgsql
as $$
begin
  return query execute format(
    'insert into pgmq.%I (message, vt) values ($1, now() + make_interval(secs => $2)) returning msg_id',
    'q_' || queue_name
  ) using msg, delay;
end
$$;

create function pgmq.read(queue_name text, vt integer, qty integer) returns setof pgmq.message_record
language plpgsql
as $$
begin
  return query execute format(
    'update pgmq.%1$I q set vt = now() + make_interval(secs => $1), read_ct = q.read_ct + 1
     where q.msg_id in (select msg_id from pgmq.%1$I where vt <= now() order by msg_id limit $2 for update skip locked)
     returning q.msg_id, q.read_ct, q.enqueued_at, q.vt, q.message',
    'q_' || queue_name
  ) using vt, qty;
end
$$;

create function pgmq.delete(queue_name text, msg_id bigint) returns boolean
language plpgsql
as $$
declare
  gone integer;
begin
  execute format('delete from pgmq.%I where msg_id = $1', 'q_' || queue_name) using msg_id;
  get diagnostics gone = row_count;
  return gone > 0;
end
$$;

create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  secret text not null
);

create view vault.decrypted_secrets as
select id, name, secret, secret as decrypted_secret from vault.secrets;

create function vault.create_secret(new_secret text, new_name text default null) returns uuid
language sql
as $$ insert into vault.secrets (name, secret) values (new_name, new_secret) returning id $$;

create function vault.update_secret(secret_id uuid, new_secret text) returns void
language sql
as $$ update vault.secrets set secret = new_secret where id = secret_id $$;

create function net.http_post(
  url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000
) returns bigint
language sql
as $$ select 0::bigint $$;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  metadata jsonb
);
