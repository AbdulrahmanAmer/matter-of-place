create or replace function public.set_asset_text(
  p_asset uuid,
  p_caption text default null,
  p_alt_text text default null,
  p_meta jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(p_meta, '{}'::jsonb);
begin
  -- A null caption or alt text keeps the stored one. max_slides is written only while meta has none, so whichever of
  -- render_carousel and write_captions comes first sets the slide count both plan from.
  update public.assets
  set caption = coalesce(p_caption, caption),
    alt_text = coalesce(p_alt_text, alt_text),
    meta = meta || case when meta ? 'max_slides' then v_meta - 'max_slides' else v_meta end
  where id = p_asset;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.set_asset_text(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.set_asset_text(uuid, text, text, jsonb) to service_role;
