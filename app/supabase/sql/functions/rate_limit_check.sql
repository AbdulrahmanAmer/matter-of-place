create or replace function public.rate_limit_check(p_checks jsonb)
returns table (allowed boolean, retry_after int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check jsonb;
  v_window interval;
  v_count int;
  v_oldest timestamptz;
  v_failed boolean := false;
  v_wait int := 0;
begin
  for v_check in select value from jsonb_array_elements(p_checks) loop
    -- Two concurrent calls on one key cannot both take its last slot.
    perform pg_advisory_xact_lock(hashtext((v_check ->> 'bucket') || ':' || (v_check ->> 'key_hash')));
    v_window := make_interval(secs => (v_check ->> 'window_seconds')::int);
    select count(*), min(r.at) into v_count, v_oldest
    from public.rate_limits r
    where r.bucket = v_check ->> 'bucket'
      and r.key_hash = v_check ->> 'key_hash'
      and r.at > now() - v_window;
    if v_count >= (v_check ->> 'limit')::int then
      v_failed := true;
      v_wait := greatest(v_wait, 1, ceil(extract(epoch from v_oldest + v_window - now()))::int);
    end if;
  end loop;
  if v_failed then
    return query select false, v_wait;
    return;
  end if;
  -- One hit per key, so two checks on one bucket with different windows each count the call once.
  insert into public.rate_limits (bucket, key_hash, at)
  select distinct c ->> 'bucket', c ->> 'key_hash', now()
  from jsonb_array_elements(p_checks) c;
  return query select true, 0;
end;
$$;

revoke execute on function public.rate_limit_check(jsonb) from public, anon, authenticated;
grant execute on function public.rate_limit_check(jsonb) to service_role;
