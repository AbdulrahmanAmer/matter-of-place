create or replace function public.account_credits(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contact public.contacts;
begin
  -- W6 item 8, rulings H119 and H137: the Five Features ledger of the signed-in person. `balance` is what is left (the
  -- sum of the rows), `purchased` and `used` the totals behind it. An entry names the request a credit was used for,
  -- never the staff reason written on its waiver.
  select * into v_contact from public.contacts c where c.id = app.contact_of(p_user);
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'name', v_contact.name,
    'email', v_contact.email,
    'balance', (select coalesce(sum(cc.quantity), 0) from public.client_credits cc where cc.contact_id = v_contact.id),
    'purchased', (
      select coalesce(sum(cc.quantity), 0) from public.client_credits cc
      where cc.contact_id = v_contact.id and cc.kind = 'purchased'
    ),
    'used', (
      select coalesce(-sum(cc.quantity), 0) from public.client_credits cc
      where cc.contact_id = v_contact.id and cc.kind = 'used'
    ),
    'entries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', cc.id,
          'kind', cc.kind,
          'quantity', cc.quantity,
          'created_at', cc.created_at,
          'address', s.address,
          'city', s.city
        )
        order by cc.created_at desc, cc.id
      )
      from public.client_credits cc
      left join public.submissions s on s.id = cc.submission_id
      where cc.contact_id = v_contact.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.account_credits(uuid) from public, anon, authenticated;
grant execute on function public.account_credits(uuid) to service_role;
