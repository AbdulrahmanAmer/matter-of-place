create or replace function public.set_ranks(
  p_property_id uuid,
  p_expected_version integer,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_hero_rank integer default null,
  p_featured_rank integer default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.properties;
  v_after public.properties;
  v_hero_holder uuid;
  v_featured_holder uuid;
begin
  -- B7 invariant 7: a rank another property holds is swapped in this transaction, so each rank stays unique.
  select * into v_before from public.properties p where p.id = p_property_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select p.id into v_hero_holder from public.properties p
  where p.hero_rank = p_hero_rank and p.id <> p_property_id for update;
  select p.id into v_featured_holder from public.properties p
  where p.featured_rank = p_featured_rank and p.id <> p_property_id for update;
  update public.properties p set hero_rank = null where p.id = v_hero_holder;
  update public.properties p set featured_rank = null where p.id = v_featured_holder;
  v_after := public.save_property(
    p_property_id, p_expected_version,
    jsonb_build_object('hero_rank', p_hero_rank, 'featured_rank', p_featured_rank, 'updated_by', p_actor)
  );
  update public.properties p set hero_rank = v_before.hero_rank where p.id = v_hero_holder;
  update public.properties p set featured_rank = v_before.featured_rank where p.id = v_featured_holder;
  perform public.write_audit(
    p_actor, p_actor_kind, 'properties.rank', 'property', p_property_id, to_jsonb(v_before), to_jsonb(v_after),
    p_request_id
  );
  return v_after.version;
end;
$$;

revoke execute on function public.set_ranks(uuid, integer, uuid, public.actor_kind, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.set_ranks(uuid, integer, uuid, public.actor_kind, text, integer, integer)
  to service_role;
