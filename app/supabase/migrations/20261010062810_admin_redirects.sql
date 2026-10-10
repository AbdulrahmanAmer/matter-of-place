-- down: drop function public.put_redirect(text, text, int, uuid, public.actor_kind, text, uuid), public.archive_redirect(uuid, uuid, public.actor_kind, text);
set lock_timeout = '5s';

create or replace function public.put_redirect(
  p_from_path text,
  p_to_path text,
  p_status int,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.redirects;
  v_after public.redirects;
  v_loops boolean;
begin
  -- Invariant 16 (GG-01), the rules of redirectSchema in src/domain/admin-settings.ts. A refused row answers
  -- invalid_redirect, with the reason as the detail the screen shows beside the row.
  if p_from_path is null or not starts_with(p_from_path, '/') or starts_with(p_from_path, '//') then
    raise exception 'invalid_redirect' using detail = 'The old address must be a path on this site.';
  end if;
  if starts_with(p_from_path, '/admin') or p_from_path = '/api' or starts_with(p_from_path, '/api/') then
    raise exception 'invalid_redirect' using detail = 'Admin and API addresses cannot be redirected.';
  end if;
  if position('?' in p_from_path) > 0 then
    raise exception 'invalid_redirect' using detail = 'The old address cannot carry a query string.';
  end if;
  if p_to_path is null or not starts_with(p_to_path, '/') or starts_with(p_to_path, '//') then
    raise exception 'invalid_redirect' using detail = 'The new address must be a path on this site.';
  end if;
  if p_to_path = p_from_path then
    raise exception 'invalid_redirect' using detail = 'A redirect cannot point to itself.';
  end if;
  if p_status is null or p_status not in (301, 302) then
    raise exception 'invalid_redirect' using detail = 'The status must be 301 or 302.';
  end if;

  -- One writer at a time, so two rows written at once cannot close a loop between them.
  lock table public.redirects in share row exclusive mode;

  if p_id is not null then
    select * into v_before from public.redirects r where r.id = p_id and r.archived_at is null for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;
  if exists (
    select 1 from public.redirects r
    where r.from_path = p_from_path and r.archived_at is null and r.id is distinct from p_id
  ) then
    raise exception 'invalid_redirect' using detail = 'That old address is already redirected.';
  end if;
  -- Follow the new address through the other active rows; reaching the old address again is a loop.
  with recursive chain (path, depth) as (
    select p_to_path, 0
    union all
    select r.to_path, c.depth + 1
    from chain c
    join public.redirects r on r.from_path = c.path and r.archived_at is null and r.id is distinct from p_id
    where c.depth < 1000
  )
  select exists (select 1 from chain where path = p_from_path) into v_loops;
  if v_loops then
    raise exception 'invalid_redirect' using detail = 'These addresses would redirect in a loop.';
  end if;

  -- B2's statement trigger on redirects raises catalog_version in this transaction (F25 a).
  if p_id is null then
    insert into public.redirects (from_path, to_path, status, created_by)
    values (p_from_path, p_to_path, p_status::smallint, p_actor)
    returning * into v_after;
  else
    update public.redirects r
    set from_path = p_from_path, to_path = p_to_path, status = p_status::smallint
    where r.id = p_id
    returning * into v_after;
  end if;
  perform public.write_audit(
    p_actor, p_actor_kind, 'settings.redirects_put', 'redirect', v_after.id,
    case when p_id is null then null else jsonb_build_object(
      'id', v_before.id, 'from_path', v_before.from_path, 'to_path', v_before.to_path, 'status', v_before.status
    ) end,
    jsonb_build_object(
      'id', v_after.id, 'from_path', v_after.from_path, 'to_path', v_after.to_path, 'status', v_after.status
    ),
    p_request_id
  );
  return jsonb_build_object(
    'id', v_after.id, 'from_path', v_after.from_path, 'to_path', v_after.to_path, 'status', v_after.status
  );
end;
$$;

revoke execute on function public.put_redirect(text, text, int, uuid, public.actor_kind, text, uuid)
  from public, anon, authenticated;
grant execute on function public.put_redirect(text, text, int, uuid, public.actor_kind, text, uuid) to service_role;

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
