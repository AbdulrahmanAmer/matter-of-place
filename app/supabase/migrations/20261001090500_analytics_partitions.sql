-- down:
--   select cron.unschedule('analytics-partitions');
--   drop table public.analytics_events;
--   drop function public.ensure_analytics_partitions(int), public.drop_old_analytics_partitions(int);
set lock_timeout = '5s';

-- Ruling H16: raw rows are partitioned by month and kept 90 days, dropped as whole partitions by B8's retention job
-- after it rolls their days into analytics_daily. Sketch columns (docs/database/schema.sql at 8dd6f26); the primary
-- key carries the partition key.
create table public.analytics_events (
  id bigint generated always as identity,
  event text not null,
  path text not null,
  data jsonb not null default '{}',
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

-- A row dated outside every monthly partition waits here and no event is lost; ensure_analytics_partitions moves it.
create table public.analytics_events_default partition of public.analytics_events default;

-- Partitioned index, read by B14's weekly 404 count and B17's web vitals counts.
create index analytics_events_event_occurred_idx on public.analytics_events (event, occurred_at desc);

create or replace function public.ensure_analytics_partitions(months_ahead int default 2)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamp;
  v_from timestamptz;
  v_to timestamptz;
  v_name text;
begin
  for i in 0..months_ahead loop
    v_start := date_trunc('month', now() at time zone 'UTC') + make_interval(months => i);
    v_from := v_start at time zone 'UTC';
    v_to := (v_start + interval '1 month') at time zone 'UTC';
    v_name := 'analytics_events_y' || to_char(v_start, 'YYYY') || 'm' || to_char(v_start, 'MM');
    if to_regclass('public.' || v_name) is null then
      -- Rows that arrived before their month had a partition wait in the default one, which refuses a new
      -- partition over them: detach it, create the month, move the rows and attach it again.
      if exists (
        select 1 from public.analytics_events_default where occurred_at >= v_from and occurred_at < v_to
      ) then
        alter table public.analytics_events detach partition public.analytics_events_default;
        execute format(
          'create table public.%I partition of public.analytics_events for values from (%L) to (%L)',
          v_name, v_from, v_to
        );
        insert into public.analytics_events overriding system value
        select * from public.analytics_events_default where occurred_at >= v_from and occurred_at < v_to;
        delete from public.analytics_events_default where occurred_at >= v_from and occurred_at < v_to;
        alter table public.analytics_events attach partition public.analytics_events_default default;
      else
        execute format(
          'create table public.%I partition of public.analytics_events for values from (%L) to (%L)',
          v_name, v_from, v_to
        );
      end if;
      -- G-100: a partition is a table of its own and takes no default privileges.
      execute format('alter table public.%I enable row level security', v_name);
      execute format('revoke all on table public.%I from anon, authenticated', v_name);
      execute format('grant all on table public.%I to service_role', v_name);
    end if;
  end loop;
end;
$$;

create or replace function public.drop_old_analytics_partitions(keep_months int default 3)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz :=
    (date_trunc('month', now() at time zone 'UTC') - make_interval(months => keep_months)) at time zone 'UTC';
  v_name text;
  v_dropped int := 0;
begin
  for v_name in
    select c.relname
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'public.analytics_events'::regclass
      and c.relname ~ '^analytics_events_y[0-9]{4}m[0-9]{2}$'
      and substring(pg_get_expr(c.relpartbound, c.oid) from 'TO \(''([^'']+)''\)')::timestamptz <= v_cutoff
    order by c.relname
  loop
    execute format('drop table public.%I', v_name);
    v_dropped := v_dropped + 1;
  end loop;
  return v_dropped;
end;
$$;

revoke execute on function public.ensure_analytics_partitions(int), public.drop_old_analytics_partitions(int)
from public, anon, authenticated;
grant execute on function public.ensure_analytics_partitions(int), public.drop_old_analytics_partitions(int)
to service_role;

alter table public.analytics_events enable row level security;
alter table public.analytics_events_default enable row level security;
-- G-100: every grant is explicit; ensure_analytics_partitions does the same for each monthly partition.
revoke all on table public.analytics_events, public.analytics_events_default from anon, authenticated;
grant all on table public.analytics_events, public.analytics_events_default to service_role;

select public.ensure_analytics_partitions();

-- Fixed job (architecture 5 rule 8): unschedule by name first, so a re-apply after db:reset never leaves two. The 20th
-- of each month at 02:00 UTC. A failure rolls the run back whole and pg_cron records it in cron.job_run_details; no
-- event is lost (rows wait in the default partition) and the next run retries, since the function is idempotent. The
-- manual retry is `bun run db:psql -- -c "select public.ensure_analytics_partitions()"`.
select cron.unschedule('analytics-partitions')
where exists (select 1 from cron.job where jobname = 'analytics-partitions');
select cron.schedule('analytics-partitions', '0 2 20 * *', 'select public.ensure_analytics_partitions()');
