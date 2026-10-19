create or replace function public.record_requested_reel(
  p_subject text,
  p_files jsonb,
  p_caption text,
  p_alt_text text,
  p_meta jsonb,
  p_property uuid default null,
  p_market text default null,
  p_story uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- W7 item 19 (H107): a reel a colleague or Matter asked for. W8 item 1: written by record_requested_asset, the one
  -- writer of every requested visual; this name stays for the reel pass, with its own refusal of a reel without files.
  if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) = 0 then
    raise exception 'requested_reel_files' using errcode = '22023';
  end if;
  return public.record_requested_asset(
    p_subject, 'reel', p_files, p_caption, p_alt_text, p_meta, p_property, p_market, p_story
  );
end;
$$;

revoke execute on function public.record_requested_reel(text, jsonb, text, text, jsonb, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_requested_reel(text, jsonb, text, text, jsonb, uuid, text, uuid)
  to service_role;
