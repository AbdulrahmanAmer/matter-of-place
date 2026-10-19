create or replace function public.spend_client_credit(
  p_submission_id uuid,
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
  v_contact uuid;
  v_package public.exposure_package;
  v_balance integer;
  v_payment uuid;
  v_event uuid;
begin
  -- W6 item 8 (ruling H137): a Five Features credit is spent on one accepted request of the contact that holds it. The
  -- waiver is `record_waiver` (ruling H18, invariant 12): no invoice, no number, no mail. The ledger row is written in the
  -- same transaction, so a credit is never used without its waiver nor waived without its credit.
  select s.contact_id, s.package into v_contact, v_package
  from public.submissions s where s.id = p_submission_id;
  if not found then
    raise exception 'not_found';
  end if;
  -- A credit buys a Five Features property: another package, or a request with no contact, has no credit to spend.
  if v_contact is null or v_package <> 'Five Features' then
    raise exception 'wrong_state';
  end if;
  -- One spender at a time per contact, so two requests accepted together cannot both use the last credit.
  perform 1 from public.contacts c where c.id = v_contact for update;
  select coalesce(sum(cc.quantity), 0) into v_balance from public.client_credits cc where cc.contact_id = v_contact;
  if v_balance < 1 then
    raise exception 'no_credit';
  end if;
  select w.payment_id, w.event_id into v_payment, v_event
  from public.record_waiver(
    p_submission_id, 'Five Features', p_amount, p_reason, p_actor, p_actor_kind, p_request_id
  ) w;
  insert into public.client_credits (contact_id, kind, quantity, payment_id, submission_id, note)
  values (v_contact, 'used', -1, v_payment, p_submission_id, p_reason);
  return query select v_payment, v_event;
end;
$$;

revoke execute on function public.spend_client_credit(
  uuid, numeric, text, uuid, public.actor_kind, text
) from public, anon, authenticated;
grant execute on function public.spend_client_credit(
  uuid, numeric, text, uuid, public.actor_kind, text
) to service_role;
