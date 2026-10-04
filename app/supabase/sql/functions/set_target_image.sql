create or replace function public.set_target_image(
  p_target text,
  p_slug text,
  p_image text,
  p_variants jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The render_variants target job (G42): the row's own image and sizes in one update; B2's triggers bump the version.
  if p_target = 'story' then
    update public.stories set image = p_image, image_variants = p_variants where slug = p_slug;
  elsif p_target = 'market' then
    update public.markets set image = p_image, image_variants = p_variants where slug = p_slug;
  elsif p_target = 'region' then
    update public.regions set image = p_image, image_variants = p_variants where slug = p_slug;
  else
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.set_target_image(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.set_target_image(text, text, text, jsonb) to service_role;
