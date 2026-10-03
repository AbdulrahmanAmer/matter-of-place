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
