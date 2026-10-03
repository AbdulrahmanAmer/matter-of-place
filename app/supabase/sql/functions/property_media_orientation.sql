create or replace function public.property_media_orientation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.variants is not distinct from old.variants then
      return new;
    end if;
  end if;
  if new.variants ? 'hero' then
    new.orientation := case
      when (new.variants -> 'hero' ->> 'h')::int > (new.variants -> 'hero' ->> 'w')::int
        then 'portrait'::public.media_orientation
      else 'landscape'::public.media_orientation
    end;
  end if;
  return new;
end;
$$;
