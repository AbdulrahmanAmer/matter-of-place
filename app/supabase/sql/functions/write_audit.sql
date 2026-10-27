create or replace function public.write_audit(
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_action text,
  p_entity text,
  p_entity_id uuid,
  p_before jsonb,
  p_after jsonb,
  p_request_id text,
  p_note text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_roles public.app_role[];
  v_kinds public.actor_kind[];
  v_rule public.action_roles;
  v_pii text[];
  v_keys text[];
  v_before jsonb := p_before;
  v_after jsonb := p_after;
  v_id bigint;
begin
  -- Invariant 18, DB-04: the actor as stored, never as the caller names it. A null actor is the system.
  -- Raised inside the writing function's transaction, so its whole change rolls back.
  if p_actor is not null then
    select array_agg(r.role), array_agg(distinct r.actor_kind)
    into v_roles, v_kinds
    from public.user_roles r
    where r.user_id = p_actor and r.disabled_at is null;
    if v_roles is null or v_kinds is distinct from array[p_actor_kind] then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    select * into v_rule from public.action_roles a where a.action = p_action;
    if not found then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if v_rule.human_only and p_actor_kind = 'agent' then
      raise exception 'human_only' using errcode = '42501';
    end if;
    if not (v_rule.roles && v_roles) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  -- DB-03: only the keys that changed, plus `id`, and no value of a personal-data column. The entity is the
  -- table name or its singular (`submission`, `property`, `story`); a hash is never stored, it can be reversed.
  if jsonb_typeof(coalesce(p_before, '{}')) = 'object' and jsonb_typeof(coalesce(p_after, '{}')) = 'object' then
    select coalesce(array_agg(p.column_name), '{}')
    into v_pii
    from public.pii_columns p
    where p.table_name in (p_entity, p_entity || 's', regexp_replace(p_entity, 'y$', 'ies'));
    select coalesce(array_agg(k.key), '{}')
    into v_keys
    from (
      select jsonb_object_keys(coalesce(p_before, '{}')) as key
      union
      select jsonb_object_keys(coalesce(p_after, '{}'))
    ) k
    where k.key = 'id' or (p_before -> k.key) is distinct from (p_after -> k.key);
    if p_before is not null then
      select coalesce(jsonb_object_agg(e.key, case when e.key = any (v_pii) then '{"pii": "changed"}'::jsonb else e.value end), '{}')
      into v_before
      from jsonb_each(p_before) e
      where e.key = any (v_keys);
    end if;
    if p_after is not null then
      select coalesce(jsonb_object_agg(e.key, case when e.key = any (v_pii) then '{"pii": "changed"}'::jsonb else e.value end), '{}')
      into v_after
      from jsonb_each(p_after) e
      where e.key = any (v_keys);
    end if;
  end if;

  insert into public.audit_log (actor_id, actor_kind, action, entity, entity_id, before, after, request_id, note)
  values (p_actor, p_actor_kind, p_action, p_entity, p_entity_id, v_before, v_after, p_request_id, p_note)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.write_audit(uuid, public.actor_kind, text, text, uuid, jsonb, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.write_audit(uuid, public.actor_kind, text, text, uuid, jsonb, jsonb, text, text)
  to service_role;
