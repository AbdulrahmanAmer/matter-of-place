-- down: drop function public.set_subject_request_status(uuid, text, uuid, public.actor_kind, text, text), public.export_subject(uuid, uuid, public.actor_kind, text), public.delete_subject(uuid, uuid, public.actor_kind, text), public.opt_out_subject(uuid, uuid, public.actor_kind, text);
set lock_timeout = '5s';

create or replace function public.set_subject_request_status(
  p_subject_request_id uuid,
  p_action text,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.subject_requests;
  v_after public.subject_requests;
  v_note text := nullif(btrim(p_note), '');
begin
  -- Invariant 15 (GP-01, B3 invariant 13): identity first. start_verification moves received to verifying,
  -- confirm_identity stamps verified_at, reject closes the request with a note, and fulfil_correction closes a
  -- correction once the row was corrected by hand on the screen that owns it.
  select * into v_row from public.subject_requests r where r.id = p_subject_request_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_action not in ('start_verification', 'confirm_identity', 'reject', 'fulfil_correction') then
    raise exception 'invalid_key';
  end if;
  if p_action = 'fulfil_correction' and v_row.kind <> 'correction' then
    raise exception 'wrong_kind';
  end if;
  if v_row.status in ('fulfilled', 'rejected')
    or (p_action = 'start_verification' and v_row.status <> 'received')
    or (p_action = 'confirm_identity' and (v_row.status <> 'verifying' or v_row.verified_at is not null)) then
    raise exception 'wrong_state';
  end if;
  if p_action = 'fulfil_correction' and v_row.verified_at is null then
    raise exception 'not_verified';
  end if;
  if p_action in ('reject', 'fulfil_correction') and v_note is null then
    raise exception 'note_required';
  end if;

  update public.subject_requests r
  set status = case p_action
      when 'start_verification' then 'verifying'
      when 'reject' then 'rejected'
      when 'fulfil_correction' then 'fulfilled'
      else r.status
    end,
    verified_at = case when p_action = 'confirm_identity' then now() else r.verified_at end,
    fulfilled_at = case when p_action = 'fulfil_correction' then now() else r.fulfilled_at end,
    handled_by = p_actor
  where r.id = p_subject_request_id
  returning * into v_after;
  -- Ids and states only: the address stays in its own table (invariant 18).
  perform public.write_audit(
    p_actor, p_actor_kind, 'audit.subject_status', 'subject_request', p_subject_request_id,
    jsonb_build_object('id', v_row.id, 'status', v_row.status, 'verified', v_row.verified_at is not null),
    jsonb_build_object('id', v_after.id, 'status', v_after.status, 'verified', v_after.verified_at is not null),
    p_request_id, v_note
  );
  return jsonb_build_object(
    'id', v_after.id, 'status', v_after.status, 'verified_at', v_after.verified_at,
    'fulfilled_at', v_after.fulfilled_at, 'handled_by', v_after.handled_by
  );
end;
$$;

revoke execute on function public.set_subject_request_status(uuid, text, uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.set_subject_request_status(uuid, text, uuid, public.actor_kind, text, text)
  to service_role;

create or replace function public.export_subject(
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
  v_contacts uuid[];
  v_bundle jsonb;
begin
  -- Invariant 15 (GP-01): an access request, once identity is confirmed, gets one bundle of every row the address
  -- appears in, and the request is fulfilled.
  select * into v_row from public.subject_requests r where r.id = p_subject_request_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_row.kind <> 'access' then
    raise exception 'wrong_kind';
  end if;
  if v_row.status in ('fulfilled', 'rejected') then
    raise exception 'wrong_state';
  end if;
  if v_row.verified_at is null then
    raise exception 'not_verified';
  end if;
  v_email := lower(v_row.email);

  -- S55: the person's contacts row with its notes, and every submission made under the address or linked to it.
  select coalesce(array_agg(c.id), '{}') into v_contacts from public.contacts c where lower(c.email) = v_email;
  select jsonb_build_object(
    'request', jsonb_build_object('id', v_row.id, 'kind', v_row.kind, 'received_at', v_row.received_at),
    'email', v_email,
    'subscribers', coalesce((
      select jsonb_agg(to_jsonb(s) - 'confirm_token_hash' order by s.created_at)
      from public.subscribers s where lower(s.email) = v_email
    ), '[]'),
    'inquiries', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.received_at)
      from public.inquiries i where lower(i.email) = v_email
    ), '[]'),
    'contacts', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at)
      from public.contacts c where c.id = any (v_contacts)
    ), '[]'),
    'submissions', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.received_at)
      from public.submissions s
      where lower(s.submitter_email) = v_email or s.contact_id = any (v_contacts)
    ), '[]')
  ) into v_bundle;

  update public.subject_requests r
  set status = 'fulfilled', fulfilled_at = now(), handled_by = p_actor
  where r.id = p_subject_request_id;
  -- Ids and counts only (invariant 18).
  perform public.write_audit(
    p_actor, p_actor_kind, 'audit.subject_export', 'subject_request', p_subject_request_id,
    jsonb_build_object('id', v_row.id, 'status', v_row.status),
    jsonb_build_object(
      'id', v_row.id, 'status', 'fulfilled',
      'counts', jsonb_build_object(
        'subscribers', jsonb_array_length(v_bundle -> 'subscribers'),
        'inquiries', jsonb_array_length(v_bundle -> 'inquiries'),
        'contacts', jsonb_array_length(v_bundle -> 'contacts'),
        'submissions', jsonb_array_length(v_bundle -> 'submissions')
      )
    ),
    p_request_id
  );
  return v_bundle;
end;
$$;

revoke execute on function public.export_subject(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.export_subject(uuid, uuid, public.actor_kind, text) to service_role;

create or replace function public.delete_subject(
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
  v_contacts uuid[];
  v_inquiries uuid[];
  v_subscribers int;
  v_submissions int;
  v_counts jsonb;
begin
  -- Invariant 15 (GP-01): a deletion request, once identity is confirmed, anonymises every row the address appears
  -- in. Nothing is hard deleted (GD-04): the rows stay for the counts and lose what names the person.
  select * into v_row from public.subject_requests r where r.id = p_subject_request_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_row.kind <> 'deletion' then
    raise exception 'wrong_kind';
  end if;
  if v_row.status in ('fulfilled', 'rejected') then
    raise exception 'wrong_state';
  end if;
  if v_row.verified_at is null then
    raise exception 'not_verified';
  end if;
  v_email := lower(v_row.email);
  select coalesce(array_agg(c.id), '{}') into v_contacts from public.contacts c where lower(c.email) = v_email;
  select coalesce(array_agg(i.id), '{}') into v_inquiries from public.inquiries i where lower(i.email) = v_email;

  -- The same columns as B8's retention_anonymise_contacts (S55); the address becomes a hash no one can write to.
  update public.submissions s
  set submitter_name = '',
    submitter_email = encode(sha256(convert_to(s.submitter_email, 'UTF8')), 'hex') || '@anonymised.invalid',
    submitter_phone = null,
    listing_agent_name = null
  where lower(s.submitter_email) = v_email or s.contact_id = any (v_contacts);
  get diagnostics v_submissions = row_count;
  update public.contacts c
  set name = '',
    email = encode(sha256(convert_to(c.email, 'UTF8')), 'hex') || '@anonymised.invalid',
    phone = null,
    brokerage = null,
    notes = null,
    archived_at = now()
  where c.id = any (v_contacts);
  -- The same columns as B8's retention_anonymise_inquiries, so screen 11 shows both paths the same way.
  update public.inquiries i
  set name = '',
    message = '',
    phone = null,
    location = null,
    details = '{}'::jsonb,
    attribution = '{}'::jsonb,
    forwarded_payload = null,
    email = encode(sha256(convert_to(i.email, 'UTF8')), 'hex') || '@anonymised.invalid',
    anonymised_at = now()
  where i.id = any (v_inquiries);
  -- G16: a webhook job of those inquiries keeps no copy of the old email or message.
  update public.jobs
  set result = result - 'body'
  where type = 'webhook_omnikom'
    and payload -> 'data' ->> 'inquiry_id' = any (v_inquiries::text[])
    and result ? 'body';
  update public.subscribers s
  set email = encode(sha256(convert_to(s.email, 'UTF8')), 'hex') || '@anonymised.invalid',
    confirm_token_hash = null,
    unsubscribed_at = coalesce(s.unsubscribed_at, now())
  where lower(s.email) = v_email;
  get diagnostics v_subscribers = row_count;

  update public.subject_requests r
  set status = 'fulfilled', fulfilled_at = now(), handled_by = p_actor
  where r.id = p_subject_request_id;
  v_counts := jsonb_build_object(
    'subscribers', v_subscribers,
    'inquiries', cardinality(v_inquiries),
    'contacts', cardinality(v_contacts),
    'submissions', v_submissions
  );
  -- Ids and counts only (invariant 18): the audit trail keeps no copy of the address.
  perform public.write_audit(
    p_actor, p_actor_kind, 'audit.subject_delete', 'subject_request', p_subject_request_id,
    jsonb_build_object('id', v_row.id, 'status', v_row.status),
    jsonb_build_object('id', v_row.id, 'status', 'fulfilled', 'counts', v_counts),
    p_request_id
  );
  return jsonb_build_object('id', v_row.id, 'status', 'fulfilled', 'counts', v_counts);
end;
$$;

revoke execute on function public.delete_subject(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.delete_subject(uuid, uuid, public.actor_kind, text) to service_role;

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
