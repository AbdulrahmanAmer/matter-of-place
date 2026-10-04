create or replace function public.beat(p_name text, p_detail jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  -- DO-03: the one writer of ops_heartbeats; ops_health reads how old each row is.
  insert into public.ops_heartbeats (name, at, detail)
  values (p_name, now(), p_detail)
  on conflict (name) do update set at = now(), detail = excluded.detail;
$$;

revoke execute on function public.beat(text, jsonb) from public, anon, authenticated;
grant execute on function public.beat(text, jsonb) to service_role;
