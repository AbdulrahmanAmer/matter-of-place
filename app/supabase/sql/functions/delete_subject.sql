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
