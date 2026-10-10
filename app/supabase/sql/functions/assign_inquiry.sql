create or replace function public.assign_inquiry(
  p_inquiry_id uuid,
  p_assignee uuid,
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
  v_state public.inquiry_state;
begin
  -- Screen 11: the assignee is a person who may act on inquiries (the roles of `inquiries.assign`). Assigning a new
  -- inquiry moves it to in_progress; a forwarded one keeps its state. A closed inquiry is not reopened (R22).
  select * into v_before from public.inquiries i where i.id = p_inquiry_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_before.state = 'closed' then
    raise exception 'wrong_state';
  end if;
  if not exists (
    select 1
    from public.user_roles r
    join public.action_roles a on a.action = 'inquiries.assign'
    where r.user_id = p_assignee
      and r.disabled_at is null
      and r.actor_kind = 'human'
      and r.role = any (a.roles)
  ) then
    raise exception 'validation' using errcode = '22023', detail = 'Choose an editor who can act on inquiries.';
  end if;

  v_state := case when v_before.state = 'new' then 'in_progress'::public.inquiry_state else v_before.state end;
  update public.inquiries
  set assigned_to = p_assignee, state = v_state
  where id = p_inquiry_id;

  perform public.write_audit(
    p_actor, p_actor_kind, 'inquiries.assign', 'inquiry', p_inquiry_id,
    jsonb_build_object('id', p_inquiry_id, 'assigned_to', v_before.assigned_to, 'state', v_before.state),
    jsonb_build_object('id', p_inquiry_id, 'assigned_to', p_assignee, 'state', v_state),
    p_request_id
  );
  return v_state;
end;
$$;

revoke execute on function public.assign_inquiry(uuid, uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.assign_inquiry(uuid, uuid, uuid, public.actor_kind, text) to service_role;
