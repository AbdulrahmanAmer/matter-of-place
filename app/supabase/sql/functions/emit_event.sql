create or replace function public.emit_event(
  p_type text,
  p_entity text,
  p_entity_id uuid default null,
  p_payload jsonb default '{}',
  p_actor_id uuid default null
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  -- A type outside the catalog fails the check constraint, so the caller's write rolls back with it.
  insert into public.events (type, entity, entity_id, payload, actor_id)
  values (p_type, p_entity, p_entity_id, coalesce(p_payload, '{}'::jsonb), p_actor_id)
  returning id
$$;

revoke execute on function public.emit_event(text, text, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.emit_event(text, text, uuid, jsonb, uuid) to service_role;
