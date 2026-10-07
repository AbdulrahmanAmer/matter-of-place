create or replace function public.issue_invoice(
  p_submission_id uuid,
  p_product public.exposure_package,
  p_amount numeric,
  p_preferred_method text,
  p_snapshot jsonb,
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
  v_settings jsonb;
  v_issued_at timestamptz := now();
  v_due_at timestamptz;
  v_number text;
  v_payment public.payments;
  v_event uuid;
begin
  -- B6 invariant 8: from Accepted, or from Invoice Issued once the earlier invoice is void.
  select s.workflow_state into v_state from public.submissions s where s.id = p_submission_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_state = 'Invoice Issued' and exists (
    select 1 from public.payments p
    where p.submission_id = p_submission_id and p.status in ('due', 'paid', 'waived')
  ) then
    raise exception 'wrong_state';
  end if;
  -- Invariant 1: B2's enforce_editorial_gate refuses every other starting state and an unaccepted request.
  update public.submissions s set workflow_state = 'Invoice Issued' where s.id = p_submission_id;

  select s.value into v_settings from public.settings s where s.key = 'invoice';
  -- Stored, so a later change of due_days never moves an issued invoice.
  v_due_at := v_issued_at + make_interval(days => (v_settings ->> 'due_days')::integer);
  v_number := public.next_invoice_number(v_settings ->> 'prefix');
  insert into public.payments (
    submission_id, product, amount, method, invoice_number, preferred_method, status, issued_by, issued_at, due_at,
    invoice_snapshot
  ) values (
    p_submission_id, p_product, p_amount, 'invoice_manual', v_number, p_preferred_method, 'due', p_actor,
    v_issued_at, v_due_at,
    -- Invariant 5: the frozen snapshot is complete once SQL adds the three fields it assigns.
    p_snapshot || jsonb_build_object(
      'invoice_number', v_number,
      'issue_date', to_char(v_issued_at at time zone 'utc', 'YYYY-MM-DD'),
      'due_date', to_char(v_due_at at time zone 'utc', 'YYYY-MM-DD')
    )
  )
  returning * into v_payment;

  perform public.write_audit(
    p_actor, p_actor_kind, 'payments.issue', 'payments', v_payment.id, null, to_jsonb(v_payment), p_request_id
  );
  v_event := public.emit_event(
    'invoice.issued', 'payment', v_payment.id,
    jsonb_build_object(
      'submission_id', p_submission_id, 'payment_id', v_payment.id, 'invoice_number', v_number,
      'tier', public.payment_tier(p_product)
    ),
    p_actor
  );
  -- Invariant 6: the PDF job commits or rolls back with the invoice.
  perform public.enqueue_job(
    'invoice_pdf',
    jsonb_build_object('params', '{}'::jsonb, 'data', jsonb_build_object('payment_id', v_payment.id)),
    'invoice_pdf:' || v_payment.id::text,
    p_max_attempts => 12
  );
  return query select v_payment.id, v_event;
end;
$$;

revoke execute on function public.issue_invoice(
  uuid, public.exposure_package, numeric, text, jsonb, uuid, public.actor_kind, text
) from public, anon, authenticated;
grant execute on function public.issue_invoice(
  uuid, public.exposure_package, numeric, text, jsonb, uuid, public.actor_kind, text
) to service_role;
