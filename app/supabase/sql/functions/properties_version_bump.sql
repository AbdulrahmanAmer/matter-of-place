create or replace function public.properties_version_bump()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- DB-16: the system columns, the two this trigger and set_updated_at write, and the generated search_text, which
  -- a BEFORE trigger sees before it is computed.
  v_ignored constant text[] := array['hero_image', 'video', 'og_image_key', 'updated_at', 'version', 'search_text'];
begin
  if (to_jsonb(new) - v_ignored) = (to_jsonb(old) - v_ignored) and new.version = old.version then
    return new;
  end if;
  new.version := old.version + 1;
  return new;
end;
$$;
