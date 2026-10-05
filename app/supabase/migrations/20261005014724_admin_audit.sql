-- down:
--   drop function public.write_audit(uuid, public.actor_kind, text, text, uuid, jsonb, jsonb, text, text),
--     public.agent_key_by_hash(text), public.touch_agent_key(uuid), public.staff_can_sign_in(text);
--   drop table public.action_roles;
--   delete from public.settings where key = 'agent_daily_limits';
set lock_timeout = '5s';

-- Invariant 18, DB-04: the roles each admin action needs, the database copy of the matrix in
-- src/server/lib/authz.ts. Rows come only from the migrations scripts/gen-action-roles.mjs writes.
-- RLS on and no policy: only the service role and the definer functions read it.
create table public.action_roles (
  action text primary key,
  roles public.app_role[] not null,
  human_only boolean not null
);
alter table public.action_roles enable row level security;
revoke all on table public.action_roles from anon, authenticated;
grant all on table public.action_roles to service_role;

-- Invariant 3, SEC-11: the daily caps of an agent (ASSUMED seeds). An admin-only key: no catalog bump (G21).
insert into public.settings (key, value)
values ('agent_daily_limits', '{"decisions_per_day": 25, "publish_per_day": 5, "requests_per_day": 2000}'::jsonb)
on conflict (key) do nothing;

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

create or replace function public.staff_can_sign_in(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Invariant 19: a sign-in link goes only to an address that holds an enabled role.
  select exists (
    select 1
    from auth.users u
    join public.user_roles r on r.user_id = u.id
    where lower(u.email) = lower(p_email) and r.disabled_at is null
  );
$$;

revoke execute on function public.staff_can_sign_in(text) from public, anon, authenticated;
grant execute on function public.staff_can_sign_in(text) to service_role;
