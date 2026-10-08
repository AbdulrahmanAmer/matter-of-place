create or replace function public.upsert_representative(
  p_fields jsonb,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.representatives;
  v_after public.representatives;
begin
  -- B7: name, brokerage, license, email and phone only; the photo has no upload here. B2's trigger on representatives
  -- bumps catalog_version.
  if exists (
    select 1 from jsonb_object_keys(p_fields) k where k not in ('name', 'brokerage', 'license', 'email', 'phone')
  ) then
    raise exception 'invalid_patch_key' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.representatives (name, brokerage, license, email, phone)
    values (
      p_fields ->> 'name', p_fields ->> 'brokerage', p_fields ->> 'license', p_fields ->> 'email', p_fields ->> 'phone'
    )
    returning * into v_after;
  else
    select * into v_before from public.representatives r where r.id = p_id for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    update public.representatives r
    set name = case when p_fields ? 'name' then p_fields ->> 'name' else r.name end,
      brokerage = case when p_fields ? 'brokerage' then p_fields ->> 'brokerage' else r.brokerage end,
      license = case when p_fields ? 'license' then p_fields ->> 'license' else r.license end,
      email = case when p_fields ? 'email' then p_fields ->> 'email' else r.email end,
      phone = case when p_fields ? 'phone' then p_fields ->> 'phone' else r.phone end
    where r.id = p_id
    returning * into v_after;
  end if;
  perform public.write_audit(
    p_actor, p_actor_kind, 'properties.representative_put', 'representative', v_after.id, to_jsonb(v_before),
    to_jsonb(v_after), p_request_id
  );
  return v_after.id;
end;
$$;

revoke execute on function public.upsert_representative(jsonb, uuid, public.actor_kind, text, uuid)
  from public, anon, authenticated;
grant execute on function public.upsert_representative(jsonb, uuid, public.actor_kind, text, uuid) to service_role;
