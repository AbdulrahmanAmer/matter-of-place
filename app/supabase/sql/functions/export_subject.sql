create or replace function public.export_subject(
  p_subject_request_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_instagram_handle text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.subject_requests;
  v_email text;
  -- W8 item 4 round 3: the Instagram handle the person names, read as delete_subject reads it.
  v_handle text := lower(nullif(btrim(ltrim(btrim(coalesce(p_instagram_handle, '')), '@')), ''));
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
    ), '[]'),
    -- W8 0h review: every email the person sent us that the mailbox check recorded.
    'inbound_mail', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.received_at)
      from public.inbound_mail m where lower(m.from_email) = v_email
    ), '[]'),
    -- W8 item 4 round 3: the comments and messages of the Instagram handle the person names; none without one.
    'social_inbox', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.received_at)
      from public.social_inbox s where v_handle is not null and lower(s.author_handle) = v_handle
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
        'submissions', jsonb_array_length(v_bundle -> 'submissions'),
        'inbound_mail', jsonb_array_length(v_bundle -> 'inbound_mail'),
        'social_inbox', jsonb_array_length(v_bundle -> 'social_inbox')
      )
    ),
    p_request_id
  );
  return v_bundle;
end;
$$;

revoke execute on function public.export_subject(uuid, uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.export_subject(uuid, uuid, public.actor_kind, text, text) to service_role;
