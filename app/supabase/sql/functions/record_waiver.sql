create or replace function public.record_waiver(
  p_submission_id uuid,
  p_product public.exposure_package,
  p_amount numeric,
  p_reason text,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns table (payment_id uuid, event_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.submission_state;
  v_payment public.payments;
  v_event uuid;
begin
  -- B6 invariant 12 (DL-01): a credit or a comp is waived without an invoice, so nobody is mailed a bill they do not
  -- owe: no number, no snapshot, no invoice_pdf job and no invoice.issued event.
  if char_length(coalesce(btrim(p_reason), '')) not between 3 and 500 then
    raise exception 'validation';
  end if;
  select s.workflow_state into v_state from public.submissions s where s.id = p_submission_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_state not in ('Accepted', 'Invoice Issued') or exists (
    select 1 from public.payments p
    where p.submission_id = p_submission_id and p.status in ('due', 'paid', 'waived')
  ) then
    raise exception 'wrong_state';
  end if;
  insert into public.payments (submission_id, product, amount, method, status, waived_by, notes)
  values (p_submission_id, p_product, p_amount, 'invoice_manual', 'waived', p_actor, p_reason)
  returning * into v_payment;
  -- Invoice Issued, so activate_submission works unchanged.
  update public.submissions s set workflow_state = 'Invoice Issued' where s.id = p_submission_id;

  perform public.write_audit(
    p_actor, p_actor_kind, 'payments.waive', 'payments', v_payment.id, null, to_jsonb(v_payment), p_request_id
  );
  v_event := public.emit_event(
    'payment.marked', 'payment', v_payment.id,
    jsonb_build_object(
      'submission_id', p_submission_id, 'payment_id', v_payment.id, 'status', 'waived', 'amount', v_payment.amount,
      'tier', public.payment_tier(p_product), 'invoiced', false
    ),
    p_actor
  );
  return query select v_payment.id, v_event;
end;
$$;

revoke execute on function public.record_waiver(
  uuid, public.exposure_package, numeric, text, uuid, public.actor_kind, text
) from public, anon, authenticated;
grant execute on function public.record_waiver(
  uuid, public.exposure_package, numeric, text, uuid, public.actor_kind, text
) to service_role;
