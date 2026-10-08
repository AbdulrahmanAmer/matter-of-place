create or replace function public.set_related(
  p_property_id uuid,
  p_expected_version integer,
  p_related text[],
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
  v_before text[];
  v_after public.properties;
begin
  -- B7 invariant 7: the lock and the version first, then the whole ordered list replaced.
  v_after := public.save_property(p_property_id, p_expected_version, '{}'::jsonb);
  if cardinality(p_related) <> (select count(distinct slug) from unnest(p_related) slug) then
    raise exception 'invalid_key';
  end if;
  select coalesce(array_agg(r.related_slug order by r.sort_order, r.related_slug), '{}') into v_before
  from public.property_related r where r.property_id = p_property_id;
  delete from public.property_related r where r.property_id = p_property_id;
  insert into public.property_related (property_id, related_slug, sort_order)
  select p_property_id, slug, (position - 1)::integer
  from unnest(p_related) with ordinality as listed (slug, position);
  perform public.write_audit(
    p_actor, p_actor_kind, 'properties.update', 'property', p_property_id, jsonb_build_object('related', v_before),
    jsonb_build_object('related', p_related), p_request_id
  );
  return v_after.version;
end;
$$;

revoke execute on function public.set_related(uuid, integer, text[], uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.set_related(uuid, integer, text[], uuid, public.actor_kind, text) to service_role;
