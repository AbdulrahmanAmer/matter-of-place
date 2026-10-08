create or replace function public.publish_property(
  p_property_id uuid,
  p_expected_version integer,
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
  v_before public.properties;
  v_after public.properties;
  v_missing text[];
  v_state public.submission_state;
  v_first boolean;
  v_today date;
  v_event uuid;
begin
  -- B7 invariants 3 and 8: counted against an agent's daily publishes, then the lock and the version (GD-01).
  perform public.assert_agent_daily_cap(p_actor, p_actor_kind, 'publish');
  v_before := public.save_property(p_property_id, p_expected_version, '{}'::jsonb);
  if v_before.editorial_state not in ('review', 'agent_review') then
    raise exception 'wrong_state';
  end if;
  -- G62: every field the public page needs, the hero and six photographs with alt text; the message names each gap.
  v_missing := array_remove(array[
    case when v_before.region_slug is null then 'region_slug' end,
    case when v_before.neighborhood is null then 'neighborhood' end,
    case when v_before.country is null then 'country' end,
    case when v_before.price is null then 'price' end,
    case when v_before.beds is null then 'beds' end,
    case when v_before.baths is null then 'baths' end,
    case when v_before.interior_sq_ft is null then 'interior_sq_ft' end,
    case when v_before.lot_acres is null then 'lot_acres' end,
    case when v_before.year_built is null then 'year_built' end,
    case when v_before.style is null then 'style' end,
    case when v_before.hero_image is null then 'hero_image' end,
    case when v_before.place is null then 'place' end,
    case when (
      select count(*) from public.property_media m
      where m.property_id = p_property_id and m.media_key is not null and btrim(coalesce(m.alt, '')) <> ''
    ) < 6 then 'six images with alt text' end
  ], null);
  if cardinality(v_missing) > 0 then
    raise exception 'publish_incomplete' using errcode = '23514', detail = 'Missing: ' || array_to_string(v_missing, ', ');
  end if;

  -- DL-03: the request gates the first publication only, and moves to Published with it.
  v_first := v_before.first_published_at is null;
  if v_before.submission_id is not null then
    select s.workflow_state into v_state from public.submissions s where s.id = v_before.submission_id for update;
    if v_first then
      if v_state <> 'Scheduled' then
        raise exception 'wrong_state';
      end if;
      update public.submissions s set workflow_state = 'Published' where s.id = v_before.submission_id;
    elsif v_state not in ('Published', 'Distribution Active', 'Completed') then
      raise exception 'wrong_state';
    end if;
  end if;

  update public.properties p
  set editorial_state = 'published', published_at = now(), updated_by = p_actor
  where p.id = p_property_id
  returning * into v_after;

  -- DL-09: the campaign runs from the first publication's day in the market's zone; a republish keeps its dates.
  if v_first then
    v_today := (now() at time zone public.market_timezone(v_after.market_slug))::date;
    update public.campaigns c
    set starts_on = v_today,
      ends_on = v_today + public.package_duration_days(c.package) - 1
    where c.property_id = p_property_id;
  end if;

  perform public.write_audit(
    p_actor, p_actor_kind, 'properties.publish', 'property', p_property_id, to_jsonb(v_before), to_jsonb(v_after),
    p_request_id
  );
  v_event := public.emit_event(
    'property.published', 'property', p_property_id,
    jsonb_strip_nulls(jsonb_build_object(
      'property_id', p_property_id,
      'slug', v_after.slug,
      'tier', v_after.campaign_tier,
      'market', v_after.market_slug,
      'submission_id', v_after.submission_id
    )),
    p_actor
  );
  return jsonb_build_object('event_id', v_event, 'version', v_after.version);
end;
$$;

revoke execute on function public.publish_property(uuid, integer, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.publish_property(uuid, integer, uuid, public.actor_kind, text) to service_role;
