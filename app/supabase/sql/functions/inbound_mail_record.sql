create or replace function public.inbound_mail_record(
  p_provider_id text,
  p_folder text,
  p_from text,
  p_name text,
  p_alias text,
  p_subject text,
  p_body text,
  p_received_at timestamptz,
  p_attachments text[],
  p_source text,
  p_state text,
  p_service text,
  p_summary text,
  p_report jsonb,
  p_line text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text := p_state;
  v_cap int;
  v_hour int;
  v_owners text[];
  v_owner text;
  v_agent uuid;
  v_id uuid;
  v_event uuid;
  v_line uuid;
begin
  -- W8 0h (operator, 2026-10-16): one message of the admin@ mailbox, as the laptop runner sorted it
  -- (scripts/workforce/mail.ts, service-notice.ts). It is recorded once: an id this table or email_replies already
  -- holds returns null, so a reply to our own email never comes in twice. A person's message ('new') emits
  -- email.received and wakes its owner, who sees only its triage (W8 0a, 0b); a service notice ('escalated') becomes
  -- the runner's fixed line in Matter's thread and a Matter run at read power (a system line, ruling H101). Neither
  -- passes the hour's cap: past it the message waits as 'capped' for a person, and the team is told once that hour.
  if p_provider_id is null or btrim(p_provider_id) = '' or p_received_at is null
    or p_source is null or p_source not in ('email_inbound', 'service_notice', 'our_mail')
    or p_state is null or p_state not in ('new', 'escalated', 'recorded', 'ignored', 'spam')
    or (p_state = 'new' and p_source <> 'email_inbound')
    or (p_state = 'escalated' and (p_source <> 'service_notice' or coalesce(btrim(p_line), '') = ''))
  then
    raise exception 'bad_request';
  end if;
  if exists (select 1 from public.inbound_mail where provider_id = p_provider_id)
    or exists (select 1 from public.email_replies where provider_id = p_provider_id)
  then
    return null;
  end if;
  if v_state in ('new', 'escalated') then
    -- 20 people's messages and 6 notices an hour reach a run; the rest are kept for a person, never dropped.
    v_cap := case when v_state = 'new' then 20 else 6 end;
    select count(*) into v_hour
    from public.inbound_mail
    where source = p_source and state in ('new', 'routed', 'held', 'escalated')
      and created_at > now() - interval '1 hour';
    if v_hour >= v_cap then
      if not exists (
        select 1 from public.inbound_mail
        where source = p_source and state = 'capped' and created_at > now() - interval '1 hour'
      ) then
        insert into public.agent_messages (thread, author_kind, author_id, author_name, body)
        values ('team', 'system', 'system', 'Mailbox', format(
          'More than %s %s arrived this hour: the rest wait in the admin (Sent emails, Inbound mail) for a person.',
          v_cap, case when p_source = 'email_inbound' then 'emails from people' else 'service notices' end
        ));
      end if;
      v_state := 'capped';
    end if;
  end if;
  if v_state = 'new' then
    -- The Editor for listings@, the Concierge for everything else, then the chief of staff. Never Matter: a person's
    -- words must not sit in the thread a person's line gives full power to (H101). Press and anything outside the
    -- criteria reaches Matter through the hold (W8 0d), as its triage, never as text.
    v_owners := array[case when p_alias = 'listings' then 'editor' else 'concierge' end, 'concierge', 'chief'];
    select a.slug, a.id into v_owner, v_agent
    from public.agents a
    where a.slug = any (v_owners) and a.slug <> 'matter' and a.state <> 'off'
    order by array_position(v_owners, a.slug)
    limit 1;
  elsif v_state = 'escalated' then
    select a.slug, a.id into v_owner, v_agent
    from public.agents a
    where a.slug = 'matter' and a.state <> 'off';
  end if;
  insert into public.inbound_mail (
    provider_id, folder, from_email, from_name, alias, subject, body, attachments, received_at, source, service,
    summary, report, owner_slug, state
  )
  values (
    p_provider_id, left(coalesce(nullif(btrim(p_folder), ''), 'Inbox'), 100),
    left(nullif(lower(btrim(coalesce(p_from, ''))), ''), 320), left(nullif(btrim(coalesce(p_name, '')), ''), 200),
    case when p_alias in ('hello', 'listings', 'press', 'privacy', 'billing', 'security', 'admin') then p_alias end,
    left(coalesce(p_subject, ''), 500), left(coalesce(p_body, ''), 6000),
    (select coalesce(array_agg(left(a, 200)), '{}') from unnest((coalesce(p_attachments, '{}'))[1:50]) as a),
    p_received_at, p_source, left(nullif(btrim(coalesce(p_service, '')), ''), 40),
    left(coalesce(p_summary, ''), 2000), p_report, v_owner, v_state
  )
  on conflict (provider_id) do nothing
  returning id into v_id;
  if v_id is null then
    return null;
  end if;
  if v_state = 'new' then
    -- The event carries the row's id and the alias (our words) only: no part of the message reaches a prompt from it.
    v_event := public.emit_event(
      'email.received', 'inbound_mail', v_id, jsonb_build_object('inbound_id', v_id, 'alias', p_alias)
    );
    if v_agent is not null then
      insert into public.agent_runs (agent_id, cause, event_id) values (v_agent, 'event', v_event)
      on conflict do nothing;
    else
      insert into public.agent_messages (thread, author_kind, author_id, author_name, body)
      values ('team', 'system', 'system', 'Mailbox',
        'An email from a person arrived and no colleague is on to read it: it waits in the admin (Sent emails, Inbound mail).');
    end if;
  elsif v_state = 'escalated' and v_agent is not null then
    -- The runner's own words with the record last, so nothing the sender wrote can stand in for it.
    insert into public.agent_messages (thread, author_kind, author_id, author_name, body)
    values ('matter', 'system', 'mailbox', 'Mailbox', left(p_line, 4000) || E'\nRecord: service_notice ' || v_id || '.')
    returning id into v_line;
    insert into public.agent_runs (agent_id, cause, message_id) values (v_agent, 'message', v_line);
  end if;
  return v_id;
end;
$$;

revoke execute on function public.inbound_mail_record(
  text, text, text, text, text, text, text, timestamptz, text[], text, text, text, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.inbound_mail_record(
  text, text, text, text, text, text, text, timestamptz, text[], text, text, text, text, jsonb, text
) to service_role;
