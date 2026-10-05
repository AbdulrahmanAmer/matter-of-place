create or replace function public.touch_agent_key(p_key_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  -- At most one write a minute per key, however many requests the key makes.
  update public.agent_keys
  set last_used_at = now()
  where id = p_key_id and (last_used_at is null or last_used_at < now() - interval '1 minute');
$$;

revoke execute on function public.touch_agent_key(uuid) from public, anon, authenticated;
grant execute on function public.touch_agent_key(uuid) to service_role;
