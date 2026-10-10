create or replace function public.archive_redirect(
  p_id uuid,
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
  v_row public.redirects;
begin
  -- Invariant 16, GD-04: removing a redirect archives it and keeps the row. B2's check pairs archived_at with
  -- enabled = false, and its statement trigger raises catalog_version in this transaction (F25 a).
  select * into v_row from public.redirects r where r.id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_row.archived_at is not null then
    raise exception 'wrong_state';
  end if;
  update public.redirects r set archived_at = now(), enabled = false where r.id = p_id returning * into v_row;
  perform public.write_audit(
    p_actor, p_actor_kind, 'settings.redirects_put', 'redirect', p_id,
    jsonb_build_object('id', p_id, 'archived', false), jsonb_build_object('id', p_id, 'archived', true),
    p_request_id
  );
  return jsonb_build_object(
    'id', v_row.id, 'from_path', v_row.from_path, 'to_path', v_row.to_path, 'status', v_row.status,
    'archived_at', v_row.archived_at
  );
end;
$$;

revoke execute on function public.archive_redirect(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.archive_redirect(uuid, uuid, public.actor_kind, text) to service_role;
