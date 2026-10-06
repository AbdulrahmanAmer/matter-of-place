create or replace function public.set_invoice_key(p_payment_id uuid, p_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  -- B6 invariant 5: the first render to finish records its object path; a second render at the same moment finds
  -- the key set and gets the stored one back, so a payment ends with one key and one object.
  update public.payments p
  set invoice_file_key = p_key
  where p.id = p_payment_id and p.invoice_file_key is null;
  select p.invoice_file_key into v_key from public.payments p where p.id = p_payment_id;
  if not found then
    raise exception 'not_found';
  end if;
  return v_key;
end;
$$;

revoke execute on function public.set_invoice_key(uuid, text) from public, anon, authenticated;
grant execute on function public.set_invoice_key(uuid, text) to service_role;
