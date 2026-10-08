create or replace function public.reorder_media(
  p_property_id uuid,
  p_order uuid[],
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
  v_before uuid[];
begin
  perform 1 from public.properties p where p.id = p_property_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(m.id order by m.sort_order, m.id), '{}') into v_before
  from public.property_media m
  where m.property_id = p_property_id;
  -- The new order names every photograph of the property once, and nothing else.
  if cardinality(coalesce(p_order, '{}')) <> cardinality(v_before)
    or (select count(distinct o) from unnest(p_order) o) <> cardinality(v_before)
    or not (p_order <@ v_before) then
    raise exception 'reorder_mismatch' using errcode = '22023', detail = 'Name every photograph once.';
  end if;

  -- One statement, so B2's statement trigger raises catalog_version once; the first photograph is the hero (G66).
  update public.property_media m
  set sort_order = (o.position - 1)::integer
  from unnest(p_order) with ordinality as o (id, position)
  where m.id = o.id and m.property_id = p_property_id and m.sort_order <> o.position - 1;

  perform public.write_audit(
    p_actor, p_actor_kind, 'media.reorder', 'property', p_property_id,
    jsonb_build_object('id', p_property_id, 'media_order', to_jsonb(v_before)),
    jsonb_build_object('id', p_property_id, 'media_order', to_jsonb(p_order)),
    p_request_id
  );
  return cardinality(p_order);
end;
$$;

revoke execute on function public.reorder_media(uuid, uuid[], uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.reorder_media(uuid, uuid[], uuid, public.actor_kind, text) to service_role;
