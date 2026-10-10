-- down:
--   drop function public.put_setting(text, jsonb, uuid, public.actor_kind, text),
--     public.team_users(integer, uuid),
--     public.revoke_all_agent_keys(uuid, public.actor_kind, text),
--     public.revoke_agent_key(uuid, uuid, public.actor_kind, text),
--     public.create_agent_key(uuid, text, text, text[], uuid, public.actor_kind, text),
--     public.set_user_disabled(uuid, boolean, uuid, public.actor_kind, text),
--     public.revoke_role(uuid, public.app_role, uuid, public.actor_kind, text),
--     public.grant_role(uuid, public.app_role, text, uuid, public.actor_kind, text, public.actor_kind, text),
--     public.is_last_admin(uuid);
set lock_timeout = '5s';

create or replace function public.is_last_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- True when this user holds the only enabled `admin` row of a person: taking it away would leave no one to run the
  -- team, since an agent is refused on every `team` route (invariant 3).
  select exists (
      select 1 from public.user_roles r
      where r.user_id = p_user_id and r.role = 'admin' and r.disabled_at is null and r.actor_kind = 'human'
    )
    and not exists (
      select 1 from public.user_roles r
      where r.user_id <> p_user_id and r.role = 'admin' and r.disabled_at is null and r.actor_kind = 'human'
    );
$$;

revoke execute on function public.is_last_admin(uuid) from public, anon, authenticated;
grant execute on function public.is_last_admin(uuid) to service_role;

create or replace function public.grant_role(
  p_user uuid,
  p_role public.app_role,
  p_note text,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_user_kind public.actor_kind default 'human',
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.actor_kind := p_user_kind;
  v_name text := p_display_name;
  v_disabled timestamptz;
  v_id uuid;
begin
  -- A user who already has roles keeps their kind and name; a new role of a disabled user starts disabled.
  perform 1 from public.user_roles r where r.user_id = p_user for update;
  if found then
    select min(r.actor_kind), max(r.display_name),
      case when bool_and(r.disabled_at is not null) then now() end
    into v_kind, v_name, v_disabled
    from public.user_roles r
    where r.user_id = p_user;
    if v_kind <> p_user_kind then
      raise exception 'invalid_key';
    end if;
  end if;
  insert into public.user_roles (user_id, role, actor_kind, display_name, disabled_at)
  values (p_user, p_role, v_kind, v_name, v_disabled)
  returning id into v_id;
  perform public.write_audit(
    p_actor, p_actor_kind, 'team.role_grant', 'user_roles', v_id, null,
    jsonb_build_object('id', v_id, 'user_id', p_user, 'role', p_role, 'actor_kind', v_kind, 'display_name', v_name),
    p_request_id, nullif(p_note, '')
  );
  return v_id;
end;
$$;

revoke execute on function public.grant_role(uuid, public.app_role, text, uuid, public.actor_kind, text, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.grant_role(uuid, public.app_role, text, uuid, public.actor_kind, text, public.actor_kind, text)
  to service_role;

create or replace function public.revoke_role(
  p_user uuid,
  p_role public.app_role,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.user_roles;
begin
  -- One writer at a time on the admin rows, so two revokes cannot each leave the other as the last admin.
  perform pg_advisory_xact_lock(hashtext('team.last_admin'));
  if p_role = 'admin' and public.is_last_admin(p_user) then
    raise exception 'last_admin' using detail = 'The team needs at least one active administrator.';
  end if;
  delete from public.user_roles r
  where r.user_id = p_user and r.role = p_role
  returning * into v_row;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.write_audit(
    p_actor, p_actor_kind, 'team.role_revoke', 'user_roles', v_row.id,
    jsonb_build_object('id', v_row.id, 'user_id', p_user, 'role', p_role), null, p_request_id
  );
end;
$$;

revoke execute on function public.revoke_role(uuid, public.app_role, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.revoke_role(uuid, public.app_role, uuid, public.actor_kind, text) to service_role;

create or replace function public.set_user_disabled(
  p_user uuid,
  p_disabled boolean,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before boolean;
begin
  perform pg_advisory_xact_lock(hashtext('team.last_admin'));
  select bool_and(r.disabled_at is not null) into v_before
  from public.user_roles r
  where r.user_id = p_user;
  if v_before is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- A repeat changes nothing and writes no audit row.
  if v_before = p_disabled then
    return p_disabled;
  end if;
  if p_disabled and public.is_last_admin(p_user) then
    raise exception 'last_admin' using detail = 'The team needs at least one active administrator.';
  end if;
  update public.user_roles r
  set disabled_at = case when p_disabled then now() end
  where r.user_id = p_user;
  perform public.write_audit(
    p_actor, p_actor_kind, 'team.user_disable', 'users', p_user,
    jsonb_build_object('id', p_user, 'disabled', v_before),
    jsonb_build_object('id', p_user, 'disabled', p_disabled),
    p_request_id
  );
  return p_disabled;
end;
$$;

revoke execute on function public.set_user_disabled(uuid, boolean, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.set_user_disabled(uuid, boolean, uuid, public.actor_kind, text) to service_role;

create or replace function public.create_agent_key(
  p_user uuid,
  p_hash text,
  p_label text,
  p_scopes text[],
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- Only the sha256 of the key arrives here; the key itself is shown once by the Worker and never stored.
  if not exists (select 1 from public.user_roles r where r.user_id = p_user and r.actor_kind = 'agent') then
    raise exception 'invalid_kind';
  end if;
  -- `team` and `settings` are never an agent's (invariant 3).
  if p_scopes && array['team', 'settings'] then
    raise exception 'validation' using errcode = '22023';
  end if;
  insert into public.agent_keys (user_id, key_hash, label, scopes)
  values (p_user, p_hash, p_label, p_scopes)
  returning id into v_id;
  perform public.write_audit(
    p_actor, p_actor_kind, 'team.agent_key_create', 'agent_keys', v_id, null,
    jsonb_build_object('id', v_id, 'user_id', p_user, 'label', p_label, 'scopes', to_jsonb(p_scopes)),
    p_request_id
  );
  return v_id;
end;
$$;

revoke execute on function public.create_agent_key(uuid, text, text, text[], uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.create_agent_key(uuid, text, text, text[], uuid, public.actor_kind, text)
  to service_role;

create or replace function public.revoke_agent_key(
  p_key uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revoked_at timestamptz;
begin
  select k.revoked_at into v_revoked_at from public.agent_keys k where k.id = p_key for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_revoked_at is not null then
    raise exception 'wrong_state';
  end if;
  update public.agent_keys k set revoked_at = now() where k.id = p_key;
  perform public.write_audit(
    p_actor, p_actor_kind, 'team.agent_key_revoke', 'agent_keys', p_key,
    jsonb_build_object('id', p_key, 'revoked', false), jsonb_build_object('id', p_key, 'revoked', true),
    p_request_id
  );
end;
$$;

revoke execute on function public.revoke_agent_key(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.revoke_agent_key(uuid, uuid, public.actor_kind, text) to service_role;

create or replace function public.revoke_all_agent_keys(
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Every live key at once; `verifyKey` looks the key up on each request, so the next call of any of them is 401.
  update public.agent_keys k set revoked_at = now() where k.revoked_at is null;
  get diagnostics v_count = row_count;
  perform public.write_audit(
    p_actor, p_actor_kind, 'team.revoke_all_keys', 'agent_keys', null, null,
    jsonb_build_object('count', v_count), p_request_id
  );
  return v_count;
end;
$$;

revoke execute on function public.revoke_all_agent_keys(uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.revoke_all_agent_keys(uuid, public.actor_kind, text) to service_role;

create or replace function public.team_users(p_limit integer default 50, p_cursor uuid default null)
returns table (
  user_id uuid,
  email text,
  display_name text,
  roles public.app_role[],
  actor_kind public.actor_kind,
  disabled boolean,
  last_active_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Screen 23: one row per user of `user_roles`, keyset-paged on the leading column of `unique (user_id, role)`.
  select r.user_id,
    u.email::text,
    max(r.display_name),
    array_agg(r.role order by r.role),
    min(r.actor_kind),
    bool_and(r.disabled_at is not null),
    greatest(u.last_sign_in_at, (select max(k.last_used_at) from public.agent_keys k where k.user_id = r.user_id))
  from public.user_roles r
  join auth.users u on u.id = r.user_id
  where p_cursor is null or r.user_id > p_cursor
  group by r.user_id, u.email, u.last_sign_in_at
  order by r.user_id
  limit least(greatest(coalesce(p_limit, 50), 1), 50);
$$;

revoke execute on function public.team_users(integer, uuid) from public, anon, authenticated;
grant execute on function public.team_users(integer, uuid) to service_role;

create or replace function public.put_setting(
  p_key text,
  p_value jsonb,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The audit action of each key this function may write; step 15 adds its settings keys here.
  v_action text := case p_key when 'agent_daily_limits' then 'team.limits_put' end;
  v_before jsonb;
begin
  if v_action is null then
    raise exception 'invalid_key';
  end if;
  if jsonb_typeof(p_value) is distinct from 'object' then
    raise exception 'validation' using errcode = '22023';
  end if;
  select s.value into v_before from public.settings s where s.key = p_key for update;
  insert into public.settings (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value;
  perform public.write_audit(
    p_actor, p_actor_kind, v_action, 'settings.' || p_key, null, v_before, p_value, p_request_id
  );
  return p_value;
end;
$$;

revoke execute on function public.put_setting(text, jsonb, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.put_setting(text, jsonb, uuid, public.actor_kind, text) to service_role;
