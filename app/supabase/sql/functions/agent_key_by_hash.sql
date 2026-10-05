create or replace function public.agent_key_by_hash(p_hash text)
returns table (
  key_id uuid,
  user_id uuid,
  scopes text[],
  revoked_at timestamptz,
  last_used_at timestamptz,
  roles public.app_role[]
)
language sql
stable
security definer
set search_path = ''
as $$
  -- The one indexed lookup of `verifyKey` (agent_keys_key_hash_key); only the key's enabled roles.
  select k.id, k.user_id, k.scopes, k.revoked_at, k.last_used_at,
    coalesce(
      (select array_agg(r.role order by r.role)
       from public.user_roles r
       where r.user_id = k.user_id and r.disabled_at is null),
      '{}'
    )
  from public.agent_keys k
  where k.key_hash = p_hash;
$$;

revoke execute on function public.agent_key_by_hash(text) from public, anon, authenticated;
grant execute on function public.agent_key_by_hash(text) to service_role;
