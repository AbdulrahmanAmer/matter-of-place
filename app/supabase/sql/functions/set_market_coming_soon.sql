create or replace function public.set_market_coming_soon(
  p_slug text,
  p_coming_soon boolean,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_notify boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.markets;
  v_new public.markets;
begin
  -- B7 step 13, screen 15. The row is locked, so two editors who press the toggle at once do not both open the market.
  select * into v_old from public.markets m where m.slug = p_slug for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_coming_soon is null then
    raise exception 'invalid_key';
  end if;
  -- Already in the state asked for: nothing changes, nothing is audited and the catalog version stays.
  if v_old.coming_soon = p_coming_soon then
    return jsonb_build_object('slug', p_slug, 'coming_soon', v_old.coming_soon, 'updated_at', v_old.updated_at);
  end if;

  -- One update, so B2's trigger on markets raises catalog_version once (F25 a).
  update public.markets m set coming_soon = p_coming_soon where m.slug = p_slug returning * into v_new;

  -- G15, G37, G58: the interest-only signups of a market opened by hand get their one mail. The key
  -- `market_open:<market>` is the one B8b's open_market_on_publish uses, so opening again later (or through a
  -- publication) finds it taken and sends nothing twice. p_notify is false until the job type has a handler (G37).
  if p_notify and not p_coming_soon then
    perform public.enqueue_job(
      'market_open_notice',
      jsonb_build_object('params', '{}'::jsonb, 'data', jsonb_build_object('market', p_slug)),
      'market_open:' || p_slug,
      p_max_attempts => 12
    );
  end if;

  perform public.write_audit(
    p_actor, p_actor_kind, 'markets.coming_soon', 'markets.' || p_slug, null,
    jsonb_build_object('coming_soon', v_old.coming_soon), jsonb_build_object('coming_soon', v_new.coming_soon),
    p_request_id
  );
  return jsonb_build_object('slug', p_slug, 'coming_soon', v_new.coming_soon, 'updated_at', v_new.updated_at);
end;
$$;

revoke execute on function public.set_market_coming_soon(text, boolean, uuid, public.actor_kind, text, boolean)
  from public, anon, authenticated;
grant execute on function public.set_market_coming_soon(text, boolean, uuid, public.actor_kind, text, boolean)
  to service_role;
