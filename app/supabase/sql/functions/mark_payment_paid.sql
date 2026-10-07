create or replace function public.mark_payment_paid(
  p_payment_id uuid,
  p_paid_at timestamptz,
  p_method text,
  p_reference text,
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
  v_before public.payments;
  v_after public.payments;
  v_event uuid;
begin
  -- B6 invariant 3: due to paid only. A null actor is the future Stripe webhook (invariant 9).
  select * into v_before from public.payments p where p.id = p_payment_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_before.status <> 'due' then
    raise exception 'wrong_state';
  end if;
  if p_paid_at is null then
    raise exception 'validation';
  end if;
  if p_paid_at > now() then
    raise exception 'paid_at_future';
  end if;
  update public.payments p
  set status = 'paid', paid_at = p_paid_at, paid_method = p_method, paid_reference = p_reference,
    paid_marked_by = p_actor
  where p.id = p_payment_id
  returning * into v_after;

  perform public.write_audit(
    p_actor, p_actor_kind, 'payments.mark_paid', 'payments', p_payment_id, to_jsonb(v_before), to_jsonb(v_after),
    p_request_id
  );
  v_event := public.emit_event(
    'payment.marked', 'payment', p_payment_id,
    jsonb_build_object(
      'submission_id', v_after.submission_id, 'payment_id', p_payment_id, 'status', 'paid', 'amount', v_after.amount,
      'tier', public.payment_tier(v_after.product), 'invoiced', v_after.invoice_number is not null
    ),
    p_actor
  );
  return query select p_payment_id, v_event;
end;
$$;

revoke execute on function public.mark_payment_paid(
  uuid, timestamptz, text, text, uuid, public.actor_kind, text
) from public, anon, authenticated;
grant execute on function public.mark_payment_paid(
  uuid, timestamptz, text, text, uuid, public.actor_kind, text
) to service_role;
