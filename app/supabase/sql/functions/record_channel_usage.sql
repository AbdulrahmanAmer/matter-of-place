create or replace function public.record_channel_usage(p_channel text, p_reads int)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month text := to_char(now() at time zone 'UTC', 'YYYY-MM');
  v_reads int;
begin
  -- INT-08: the month's X reads; a new UTC month starts the count again. `x` is not a public key (G21).
  if p_channel is distinct from 'x' then
    raise exception 'validation' using errcode = '22023';
  end if;
  insert into public.settings as s (key, value)
  values (p_channel, jsonb_build_object('usage', jsonb_build_object('month', v_month, 'reads', p_reads)))
  on conflict (key) do update
  set value = s.value || jsonb_build_object(
    'usage', jsonb_build_object(
      'month', v_month,
      'reads', p_reads + case
        when s.value -> 'usage' ->> 'month' = v_month then coalesce((s.value -> 'usage' ->> 'reads')::int, 0)
        else 0
      end
    )
  )
  returning (value -> 'usage' ->> 'reads')::int into v_reads;
  return v_reads;
end;
$$;

revoke execute on function public.record_channel_usage(text, int) from public, anon, authenticated;
grant execute on function public.record_channel_usage(text, int) to service_role;
