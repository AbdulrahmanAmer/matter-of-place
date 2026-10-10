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
