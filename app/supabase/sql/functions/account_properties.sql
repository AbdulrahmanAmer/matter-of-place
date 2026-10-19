create or replace function public.account_properties(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contact public.contacts;
begin
  -- W6 item 8, rulings H119 and H137: the signed-in person's requests with the dates their timeline needs and the path
  -- of the live page, through the same mapping as `account_room`. Null when no contact matches. The fixed field list
  -- leaves out every staff column (notes, the decline note and reason, reviewer ids, address hashes).
  select * into v_contact from public.contacts c where c.id = app.contact_of(p_user);
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'name', v_contact.name,
    'email', v_contact.email,
    'properties', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'address', s.address,
          'city', s.city,
          'state', s.state,
          'package', s.package,
          'workflow_state', s.workflow_state,
          'received_at', s.received_at,
          'reviewed_at', s.reviewed_at,
          'accepted_at', s.accepted_at,
          'activated_at', s.activated_at,
          'published_at', p.published_at,
          -- The photographs on the request, and whether more can be added: until it is activated (account_add_photos).
          'photos', (select count(*) from public.submission_media m where m.submission_id = s.id),
          'can_add_photos', s.workflow_state in (
            'Submitted', 'Under Review', 'Accepted', 'Awaiting Assets', 'Invoice Issued'
          ),
          -- The page a visitor can open: only a published property has one (a takedown archives it).
          'live_path', case when p.editorial_state = 'published' then '/property/' || p.slug end
        )
        order by s.received_at desc, s.id
      )
      from public.submissions s
      left join public.properties p on p.id = s.property_id
      where s.contact_id = v_contact.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.account_properties(uuid) from public, anon, authenticated;
grant execute on function public.account_properties(uuid) to service_role;
