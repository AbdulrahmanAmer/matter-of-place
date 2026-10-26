create or replace function public.payments_grant_credits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credits integer := public.credits_in_package(new.product);
  v_contact uuid;
begin
  -- W6 item 8 (ruling H142): a pack's credits are bought when its payment is paid, once. The property the pack was
  -- paid with is the first of the five, so it uses a credit in the same moment. A request with no contact (a fixture
  -- row; create_submission links every real one) has no ledger.
  if new.status <> 'paid' or v_credits is null or (tg_op = 'UPDATE' and old.status = 'paid') then
    return new;
  end if;
  select s.contact_id into v_contact from public.submissions s where s.id = new.submission_id;
  if v_contact is null then
    return new;
  end if;
  insert into public.client_credits (contact_id, kind, quantity, payment_id, note)
  values (v_contact, 'purchased', v_credits, new.id, new.product::text || ' paid')
  on conflict do nothing;
  insert into public.client_credits (contact_id, kind, quantity, payment_id, submission_id, note)
  values (v_contact, 'used', -1, new.id, new.submission_id, 'The first property of the pack')
  on conflict do nothing;
  return new;
end;
$$;

revoke execute on function public.payments_grant_credits() from public, anon, authenticated;
