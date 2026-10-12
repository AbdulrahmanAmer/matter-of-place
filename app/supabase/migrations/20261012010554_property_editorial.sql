-- down: re-run bun run db:fn create_property_editorial from the previous commit of supabase/sql/functions/create_property_editorial.sql
set lock_timeout = '5s';

create or replace function public.create_property_editorial(
  p_title text,
  p_market_slug text,
  p_city text,
  p_address text,
  p_type public.property_type,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_price numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_state text;
  v_base text;
  v_slug text;
  v_suffix integer := 1;
  v_after public.properties;
begin
  -- Operator, 2026-10-12: an editor enters a property by hand, without a request. The draft holds the four facts every
  -- property needs; the rest is filled on the property screen, and publishing runs the same checks as any other.
  -- Never 'Illustrative': production refuses that status (S35), so a hand-made property is 'Active'.
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 200
    or char_length(btrim(coalesce(p_city, ''))) not between 1 and 120
    or char_length(btrim(coalesce(p_address, ''))) not between 1 and 300
    or (p_price is not null and p_price <= 0) then
    raise exception 'validation';
  end if;
  v_state := case p_market_slug
    when 'california' then 'California'
    when 'new-york' then 'New York'
    when 'florida' then 'Florida'
  end;
  if v_state is null then
    raise exception 'validation';
  end if;

  -- G62, as for a request: the city slugified, then the first eight characters of the id; editable until published.
  v_base := btrim(left(regexp_replace(lower(btrim(p_city)), '[^a-z0-9]+', '-', 'g'), 100), '-');
  v_base := case when v_base = '' then '' else v_base || '-' end || left(v_id::text, 8);
  v_slug := v_base;
  while exists (select 1 from public.properties p where p.slug = v_slug)
    or exists (select 1 from public.slug_history h where h.slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_base || '-' || v_suffix::text;
  end loop;

  insert into public.properties (
    id, slug, title, market_slug, city, state, country, address, price, type, status, source, created_by, updated_by,
    editorial_state
  ) values (
    v_id, v_slug, btrim(p_title), p_market_slug, btrim(p_city), v_state, 'United States', btrim(p_address), p_price,
    p_type, 'Active', 'Editorial', p_actor, p_actor, 'draft'
  )
  returning * into v_after;

  perform public.write_audit(
    p_actor, p_actor_kind, 'properties.create', 'property', v_id, null, to_jsonb(v_after), p_request_id
  );
  return jsonb_build_object('property_id', v_id);
end;
$$;

revoke execute on function public.create_property_editorial(
  text, text, text, text, public.property_type, uuid, public.actor_kind, text, numeric
) from public, anon, authenticated;
grant execute on function public.create_property_editorial(
  text, text, text, text, public.property_type, uuid, public.actor_kind, text, numeric
) to service_role;
