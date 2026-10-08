create or replace function public.set_media_alt(
  p_media_id uuid,
  p_alt text,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.property_media;
  v_after public.property_media;
begin
  select * into v_before from public.property_media m where m.id = p_media_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.property_media m
  set alt = nullif(btrim(p_alt), '')
  where m.id = p_media_id
  returning * into v_after;
  perform public.write_audit(
    p_actor, p_actor_kind, 'media.alt', 'property_media', p_media_id, to_jsonb(v_before), to_jsonb(v_after),
    p_request_id
  );
end;
$$;

revoke execute on function public.set_media_alt(uuid, text, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.set_media_alt(uuid, text, uuid, public.actor_kind, text) to service_role;
