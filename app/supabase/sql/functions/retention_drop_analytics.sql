create or replace function public.retention_drop_analytics(p_dry_run boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keep interval;
  v_months int;
  v_cutoff timestamptz;
  v_part record;
  v_count int := 0;
begin
  -- Ruling H16, PERF-02: whole monthly partitions go once older than the analytics_events period, each rolled up into
  -- analytics_daily first. 90 days gives 3 months, so a raw row lives at least 90 days and at most about 120.
  select keep_for into v_keep
  from public.retention_policies
  where key = 'analytics_events' and enabled and keep_for is not null;
  if not found then
    return 0;
  end if;
  v_months := ceil(extract(epoch from v_keep) / 2592000)::int;
  v_cutoff := (date_trunc('month', now() at time zone 'UTC') - make_interval(months => v_months)) at time zone 'UTC';
  for v_part in
    select substring(pg_get_expr(c.relpartbound, c.oid) from 'FROM \(''([^'']+)''\)')::timestamptz as lower_bound,
      substring(pg_get_expr(c.relpartbound, c.oid) from 'TO \(''([^'']+)''\)')::timestamptz as upper_bound
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'public.analytics_events'::regclass
      and c.relname ~ '^analytics_events_y[0-9]{4}m[0-9]{2}$'
  loop
    if v_part.upper_bound <= v_cutoff then
      v_count := v_count + 1;
      if not p_dry_run then
        perform public.rollup_analytics_daily(
          (v_part.lower_bound at time zone 'UTC')::date, (v_part.upper_bound at time zone 'UTC')::date - 1
        );
      end if;
    end if;
  end loop;
  if p_dry_run then
    return v_count;
  end if;
  return public.drop_old_analytics_partitions(v_months);
end;
$$;

revoke execute on function public.retention_drop_analytics(boolean) from public, anon, authenticated;
grant execute on function public.retention_drop_analytics(boolean) to service_role;
