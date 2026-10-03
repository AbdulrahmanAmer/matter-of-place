create or replace function public.enforce_publish_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.editorial_state <> 'published' then
    return new;
  end if;
  -- Not security definer, so current_user is the caller; the server functions check roles before they call.
  if (tg_op = 'INSERT' or old.editorial_state <> 'published')
    and not (
      current_user in ('service_role', 'postgres')
      or public.role_in('chief_editor', 'managing_editor', 'admin')
    ) then
    raise exception 'publish_not_allowed';
  end if;
  -- A published property fills every field of the public Property type, whoever writes it.
  if tg_table_name = 'properties' and (
    new.region_slug is null or new.neighborhood is null or new.country is null or new.price is null
    or new.beds is null or new.baths is null or new.interior_sq_ft is null or new.lot_acres is null
    or new.year_built is null or new.style is null or new.hero_image is null or new.place is null
  ) then
    raise exception 'publish_incomplete' using errcode = '23514';
  end if;
  return new;
end;
$$;
