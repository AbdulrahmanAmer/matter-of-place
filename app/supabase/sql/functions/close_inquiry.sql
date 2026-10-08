create or replace function public.close_inquiry(
  p_inquiry_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns public.inquiry_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.inquiries;
begin
  -- Screen 11: any open inquiry closes, and a closed one stays closed (R22).
  select * into v_before from public.inquiries i where i.id = p_inquiry_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_before.state = 'closed' then
    raise exception 'wrong_state';
  end if;

  update public.inquiries set state = 'closed' where id = p_inquiry_id;

  perform public.write_audit(
    p_actor, p_actor_kind, 'inquiries.close', 'inquiry', p_inquiry_id,
    jsonb_build_object('id', p_inquiry_id, 'state', v_before.state),
    jsonb_build_object('id', p_inquiry_id, 'state', 'closed'),
    p_request_id
  );
  return 'closed'::public.inquiry_state;
end;
$$;

revoke execute on function public.close_inquiry(uuid, uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.close_inquiry(uuid, uuid, public.actor_kind, text) to service_role;
