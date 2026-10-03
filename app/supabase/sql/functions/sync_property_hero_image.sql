create or replace function public.sync_property_hero_image()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_property_id uuid;
  v_key text;
begin
  if tg_op = 'INSERT' then
    v_ids := array[new.property_id];
  elsif tg_op = 'DELETE' then
    v_ids := array[old.property_id];
  else
    v_ids := array[old.property_id, new.property_id];
  end if;
  foreach v_property_id in array v_ids loop
    select m.media_key into v_key
    from public.property_media m
    where m.property_id = v_property_id
    order by m.sort_order, m.id
    limit 1;
    update public.properties
    set hero_image = v_key
    where id = v_property_id
      and hero_image is distinct from v_key;
  end loop;
  return null;
end;
$$;
