create or replace function public.void_payment(
  p_payment_id uuid,
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
  v_before public.payments;
  v_after public.payments;
  v_event uuid;
begin
  -- ASSUMED A3: an invoice issued in error is voided with a reason; its number is never reused, and the request stays
  -- in Invoice Issued until a corrected invoice is issued. A paid or waived payment is never voided.
  if char_length(coalesce(btrim(p_reason), '')) not between 3 and 500 then
    raise exception 'validation';
  end if;
  select * into v_before from public.payments p where p.id = p_payment_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_before.status <> 'due' then
    raise exception 'wrong_state';
  end if;
  update public.payments p
  set status = 'void', notes = p_reason
  where p.id = p_payment_id
  returning * into v_after;

  perform public.write_audit(
    p_actor, p_actor_kind, 'payments.void', 'payments', p_payment_id, to_jsonb(v_before), to_jsonb(v_after),
    p_request_id
  );
  v_event := public.emit_event(
    'invoice.voided', 'payment', p_payment_id,
    jsonb_build_object(
      'submission_id', v_after.submission_id, 'payment_id', p_payment_id,
      'invoice_number', v_after.invoice_number, 'reason', p_reason
    ),
    p_actor
  );
  return query select p_payment_id, v_event;
end;
$$;

revoke execute on function public.void_payment(uuid, text, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.void_payment(uuid, text, uuid, public.actor_kind, text) to service_role;
