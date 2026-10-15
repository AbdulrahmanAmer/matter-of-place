create or replace function public.account_room(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contact public.contacts;
begin
  -- W6 item 7, ruling H113 (3): the room of the signed-in person `p_user` (the Worker passes the verified session's
  -- user, never a browser value), through the same mapping the row rules use. Null when no contact matches.
  select * into v_contact from public.contacts c where c.id = app.contact_of(p_user);
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'name', v_contact.name,
    'requests', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'address', s.address,
          'city', s.city,
          'state', s.state,
          'workflow_state', s.workflow_state,
          'received_at', s.received_at
        )
        order by s.received_at desc, s.id
      )
      from public.submissions s
      where s.contact_id = v_contact.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.account_room(uuid) from public, anon, authenticated;
grant execute on function public.account_room(uuid) to service_role;
