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
