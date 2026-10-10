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
