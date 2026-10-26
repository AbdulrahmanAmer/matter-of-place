create or replace function public.account_invoices(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contact public.contacts;
begin
  -- W6 item 8, rulings H119 and H142: the signed-in person's invoices and waivers, newest first. A voided invoice was
  -- withdrawn in error and is not shown. Left out: `notes` (a staff reason), the invoice snapshot, who issued or marked
  -- it, and the Stripe reference. `credit` is true for a waiver that spent a Five Features credit.
  select * into v_contact from public.contacts c where c.id = app.contact_of(p_user);
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'name', v_contact.name,
    'email', v_contact.email,
    'invoices', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pay.id,
          'address', s.address,
          'city', s.city,
          'product', pay.product,
          'amount', pay.amount,
          'currency', pay.currency,
          'status', pay.status,
          'invoice_number', pay.invoice_number,
          'issued_at', pay.issued_at,
          'due_at', pay.due_at,
          'paid_at', pay.paid_at,
          'credit', pay.status = 'waived' and exists (
            select 1 from public.client_credits cc where cc.payment_id = pay.id and cc.kind = 'used'
          )
        )
        order by coalesce(pay.issued_at, pay.created_at) desc, pay.id
      )
      from public.payments pay
      join public.submissions s on s.id = pay.submission_id
      where s.contact_id = v_contact.id and pay.status <> 'void'
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.account_invoices(uuid) from public, anon, authenticated;
grant execute on function public.account_invoices(uuid) to service_role;
