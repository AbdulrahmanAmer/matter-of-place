create or replace function public.opt_out_subject(
  p_subject_request_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.subject_requests;
  v_email text;
  v_unsubscribed int;
  v_suppressed int;
  v_counts jsonb;
begin
  -- Invariant 15 (GP-01): an opt-out request, once identity is confirmed, unsubscribes the address and suppresses it,
  -- so no recipe, digest or broadcast mails it again; B11's syncAudience then removes it from Resend (G14).
  select * into v_row from public.subject_requests r where r.id = p_subject_request_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_row.kind <> 'opt_out' then
    raise exception 'wrong_kind';
  end if;
  if v_row.status in ('fulfilled', 'rejected') then
    raise exception 'wrong_state';
  end if;
  if v_row.verified_at is null then
    raise exception 'not_verified';
  end if;
  v_email := lower(v_row.email);

  update public.subscribers s
  set unsubscribed_at = now()
  where lower(s.email) = v_email and s.unsubscribed_at is null;
  get diagnostics v_unsubscribed = row_count;
  insert into public.email_suppressions (email, reason) values (v_email, 'manual') on conflict do nothing;
  get diagnostics v_suppressed = row_count;

  update public.subject_requests r
  set status = 'fulfilled', fulfilled_at = now(), handled_by = p_actor
  where r.id = p_subject_request_id;
  v_counts := jsonb_build_object('subscribers', v_unsubscribed, 'suppressions', v_suppressed);
  -- Ids and counts only (invariant 18).
  perform public.write_audit(
    p_actor, p_actor_kind, 'audit.subject_opt_out', 'subject_request', p_subject_request_id,
    jsonb_build_object('id', v_row.id, 'status', v_row.status),
    jsonb_build_object('id', v_row.id, 'status', 'fulfilled', 'counts', v_counts),
    p_request_id
  );
  return jsonb_build_object('id', v_row.id, 'status', 'fulfilled', 'counts', v_counts);
end;
$$;

revoke execute on function public.opt_out_subject(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.opt_out_subject(uuid, uuid, public.actor_kind, text) to service_role;
