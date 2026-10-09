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
