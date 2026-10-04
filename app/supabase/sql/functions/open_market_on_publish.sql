create or replace function public.open_market_on_publish(p_property_id uuid, p_notify boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
begin
  -- B2's trigger on markets bumps catalog_version; this function never touches settings.
  update public.markets
  set coming_soon = false
  where slug = (
      select p.market_slug from public.properties p where p.id = p_property_id and p.editorial_state = 'published'
    )
    and coming_soon
  returning slug into v_slug;
  if v_slug is null then
    return null;
  end if;
  -- G43, B3b invariant 4: a system change, so no actor.
  insert into public.audit_log (actor_id, actor_kind, action, entity, note)
  values (null, null, 'market.opened', 'markets', 'system');
  -- G15, G58: the same type, payload and key as B7's set_market_coming_soon, in the transaction that opens it.
  if p_notify then
    perform public.enqueue_job(
      'market_open_notice',
      jsonb_build_object('params', '{}'::jsonb, 'data', jsonb_build_object('market', v_slug)),
      'market_open:' || v_slug
    );
  end if;
  return v_slug;
end;
$$;

revoke execute on function public.open_market_on_publish(uuid, boolean) from public, anon, authenticated;
grant execute on function public.open_market_on_publish(uuid, boolean) to service_role;
