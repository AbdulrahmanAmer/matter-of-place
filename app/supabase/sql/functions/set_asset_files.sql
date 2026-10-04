create or replace function public.set_asset_files(p_asset uuid, p_files jsonb, p_spec_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The render onResult: files and the spec hash only, and a stored error is cleared (invariant 11). It never touches
  -- caption, alt_text or meta.captions, so the order of the concurrent steps does not matter.
  update public.assets
  set files = p_files,
    meta = meta || jsonb_build_object('spec_hash', p_spec_hash),
    render_error = null
  where id = p_asset;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.set_asset_files(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.set_asset_files(uuid, jsonb, text) to service_role;
