create or replace function public.email_reply_record(
  p_provider_id text,
  p_from text,
  p_name text,
  p_subject text,
  p_body text,
  p_received_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text := lower(btrim(coalesce(p_from, '')));
  v_topic text := lower(btrim(regexp_replace(
    coalesce(p_subject, ''), '^(\s*(re|fw|fwd|aw|sv)\s*(\[\d+\])?\s*:\s*)+', '', 'i')));
  v_send record;
  v_owners text[];
  v_owner text;
  v_id uuid;
  v_line uuid;
  v_text text;
begin
  -- W4 (operator, 2026-10-13): a reply to an email we sent, read from the Zoho mailbox by the laptop runner
  -- (scripts/workforce/mail.ts). It is matched to the newest send to the same address whose subject the reply's
  -- subject carries, else the newest send to that address, within 90 days (the email_pii period). Mail from anyone
  -- we did not write to is never stored. A reply already recorded, or one with no send, returns null.
  if v_from = '' or p_provider_id is null or btrim(p_provider_id) = '' then
    raise exception 'bad_request';
  end if;
  if exists (select 1 from public.email_replies where provider_id = p_provider_id) then
    return null;
  end if;
  select m.id, m.subject, m.entity, m.entity_id into v_send
  from public.email_messages m
  where m.to_email = v_from
    and m.kind in ('transactional', 'bulk')
    and m.entity in ('submission', 'inquiry', 'subscriber', 'subject_request')
    and m.created_at > p_received_at - interval '90 days'
    and m.created_at <= p_received_at
  order by
    (coalesce(btrim(m.subject), '') <> '' and position(lower(btrim(m.subject)) in v_topic) > 0) desc,
    m.created_at desc
  limit 1;
  if not found then
    return null;
  end if;
  -- The colleague who owns the thread: the Editor for a property request, the Concierge for everything else, then
  -- the chief of staff. Never Matter: a reply is outside text and must not sit in the thread a person's line gives
  -- full power to (ruling H101).
  v_owners := array[case when v_send.entity = 'submission' then 'editor' else 'concierge' end, 'concierge', 'chief'];
  select a.slug into v_owner
  from public.agents a
  where a.slug = any (v_owners) and a.slug <> 'matter' and a.state <> 'off'
  order by array_position(v_owners, a.slug)
  limit 1;
  insert into public.email_replies (
    provider_id, from_email, from_name, subject, body, received_at, send_id, entity, entity_id, owner_slug
  )
  values (
    p_provider_id, v_from, left(nullif(btrim(coalesce(p_name, '')), ''), 200), left(coalesce(p_subject, ''), 500),
    left(coalesce(p_body, ''), 6000), p_received_at, v_send.id, v_send.entity, v_send.entity_id, v_owner
  )
  returning id into v_id;
  if v_owner is null then
    return v_id;
  end if;
  -- The reply wakes its owner once through a system line that names it and carries none of its text, not even the
  -- sender's address (W8 0b): the runner reads the reply from email_replies, has a call with no tools triage it, and
  -- shows the owner only the triage (scripts/workforce/triage.ts). The text stays here for a person to read. Our own
  -- email's subject is ours. A system line never gives full power (matterPower in scripts/matter/run.ts), and an
  -- answer is only ever a proposal.
  v_text := format(
    'An email reply arrived about our email "%s" (reply %s). You are shown it only as its triage.',
    regexp_replace(left(coalesce(v_send.subject, ''), 200), '(<<<|>>>)', '', 'g'), v_id
  );
  insert into public.agent_messages (thread, author_kind, author_id, author_name, body)
  values (v_owner, 'system', 'email', 'Email reply', v_text)
  returning id into v_line;
  insert into public.agent_runs (agent_id, cause, message_id)
  select a.id, 'message', v_line from public.agents a where a.slug = v_owner;
  return v_id;
end;
$$;

revoke execute on function public.email_reply_record(text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.email_reply_record(text, text, text, text, text, timestamptz) to service_role;
