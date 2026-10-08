-- down: drop function public.withdraw_submission(uuid, text, uuid, public.actor_kind, text);
set lock_timeout = '5s';

create or replace function public.withdraw_submission(
  p_submission_id uuid,
  p_reason text,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns public.submission_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.submissions;
  v_after public.submissions;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_payment uuid;
begin
  -- DL-04, B7 invariant 5: Accepted, Awaiting Assets or Invoice Issued to the terminal Withdrawn. A due invoice is
  -- voided in the same transaction by B6's void_payment, which audits payments.void and emits invoice.voided; while a
  -- paid or waived payment exists, B2's enforce_editorial_gate refuses the update with wrong_state. Audit only: no
  -- catalog event, and never submission.declined, whose recipe would mail the submitter a decline letter.
  if char_length(v_reason) not between 3 and 500 then
    raise exception 'validation';
  end if;
  select * into v_before from public.submissions s where s.id = p_submission_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_before.workflow_state not in ('Accepted', 'Awaiting Assets', 'Invoice Issued') then
    raise exception 'wrong_state';
  end if;
  for v_payment in
    select p.id from public.payments p where p.submission_id = p_submission_id and p.status = 'due' order by p.id
  loop
    perform public.void_payment(v_payment, 'withdrawn', p_actor, p_actor_kind, p_request_id);
  end loop;
  update public.submissions s
  set workflow_state = 'Withdrawn'
  where s.id = p_submission_id
  returning * into v_after;
  perform public.write_audit(
    p_actor, p_actor_kind, 'submissions.withdraw', 'submission', p_submission_id, to_jsonb(v_before),
    to_jsonb(v_after), p_request_id, v_reason
  );
  return v_after.workflow_state;
end;
$$;

revoke execute on function public.withdraw_submission(uuid, text, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.withdraw_submission(uuid, text, uuid, public.actor_kind, text) to service_role;
