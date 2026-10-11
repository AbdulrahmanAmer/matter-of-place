create or replace function public.settings_put_products(
  p_value jsonb,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plans jsonb := p_value -> 'plans';
  v_bound int;
  v_bad int;
  v_recommended int;
  v_before jsonb;
begin
  -- Invariants 2 and 7 (H80): the rules of productsSettingSchema that SQL states again. The four plans are bound to
  -- the four exposure_package ids, so a count other than four, or ids that are not those four each once, is refused.
  if jsonb_typeof(p_value) is distinct from 'object' or jsonb_typeof(v_plans) is distinct from 'array' then
    raise exception 'validation' using errcode = '22023';
  end if;
  select count(distinct p.value ->> 'id')
  into v_bound
  from jsonb_array_elements(v_plans) p
  where p.value ->> 'id' in ('feature', 'reach', 'campaign', 'five-features');
  if jsonb_array_length(v_plans) <> 4 or v_bound <> 4 then
    raise exception 'validation' using errcode = '22023', detail = 'adding or removing a plan needs a migration';
  end if;

  -- Each plan an object with a whole price of 1 to 1,000,000 dollars and a boolean flag (absent reads false), at
  -- most one of them recommended. The price is read as a number only when it is one, so a string never casts.
  select
    count(*) filter (
      where jsonb_typeof(v.plan) is distinct from 'object'
        or v.price is null
        or v.price <> trunc(v.price)
        or v.price < 1
        or v.price > 1000000
        or coalesce(jsonb_typeof(v.plan -> 'recommended'), 'boolean') <> 'boolean'
    ),
    count(*) filter (where v.plan -> 'recommended' = 'true'::jsonb)
  into v_bad, v_recommended
  from (
    select
      p.value as plan,
      case when jsonb_typeof(p.value -> 'price') = 'number' then (p.value ->> 'price')::numeric end as price
    from jsonb_array_elements(v_plans) p
  ) v;
  if v_bad > 0 or v_recommended > 1 then
    raise exception 'validation' using errcode = '22023';
  end if;

  -- `products` is a public key: B2's trigger on settings raises catalog_version in this same transaction.
  select s.value into v_before from public.settings s where s.key = 'products' for update;
  insert into public.settings (key, value, updated_by)
  values ('products', p_value, p_actor)
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;

  perform public.write_audit(
    p_actor, p_actor_kind, 'settings.products_put', 'settings.products', null, v_before, p_value, p_request_id, p_note
  );
end;
$$;

revoke execute on function public.settings_put_products(jsonb, uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.settings_put_products(jsonb, uuid, public.actor_kind, text, text) to service_role;
