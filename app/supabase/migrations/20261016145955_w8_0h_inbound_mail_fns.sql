-- down: re-run bun run db:fn inbound_mail_record ops_health retention_delete_rows export_subject delete_subject from the previous commit of supabase/sql/functions/inbound_mail_record.sql, supabase/sql/functions/ops_health.sql, supabase/sql/functions/retention_delete_rows.sql, supabase/sql/functions/export_subject.sql, supabase/sql/functions/delete_subject.sql
set lock_timeout = '5s';

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
  -- Only one of our aliases is kept or put in the event; anything else is null.
  v_alias text := case
    when p_alias in ('hello', 'listings', 'press', 'privacy', 'billing', 'security', 'admin') then p_alias
  end;
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
    -- criteria reaches Matter through the hold (W8 0d), as its triage, never as text. A property offered to any other
    -- address is handed to the Editor by the runner once the triage says so (inbound-mail.ts, handToEditor).
    v_owners := array[case when v_alias = 'listings' then 'editor' else 'concierge' end, 'concierge', 'chief'];
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
    v_alias,
    -- W8 0h review: only a person's email keeps its body; a service's or our own mail can carry a login code.
    left(coalesce(p_subject, ''), 500),
    case when p_source = 'email_inbound' then left(coalesce(p_body, ''), 6000) else '' end,
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
      'email.received', 'inbound_mail', v_id, jsonb_build_object('inbound_id', v_id, 'alias', v_alias)
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
  elsif v_state = 'escalated' then
    -- W8 0h review: with Matter off, the team is told, as for a person's email with no colleague on.
    insert into public.agent_messages (thread, author_kind, author_id, author_name, body)
    values ('team', 'system', 'system', 'Mailbox',
      'A service notice arrived and Matter is off to read it: it waits in the admin (Sent emails, Inbound mail).');
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

create or replace function public.ops_health(p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_failing text[] := '{}';
  v_keepwarm boolean := false;
  v_backup boolean := false;
begin
  -- DO-03, JOB-04: a runner the cron cannot reach never beats, so a stale row covers a 401, a 500 and a paused project.
  if not exists (
    select 1 from public.ops_heartbeats where name = 'runner' and at >= p_now - interval '3 minutes'
  ) then
    v_failing := array_append(v_failing, 'runner');
  end if;
  -- B8b's schedule_settings: keepwarm and backup are watched only while their row is enabled, and not before it exists.
  if to_regclass('public.schedule_settings') is not null then
    execute $q$
      select coalesce(bool_or(enabled) filter (where key = 'keepwarm'), false),
        coalesce(bool_or(enabled) filter (where key = 'backup'), false)
      from public.schedule_settings
    $q$ into v_keepwarm, v_backup;
  end if;
  if v_keepwarm and not exists (
    select 1 from public.ops_heartbeats where name = 'keepwarm' and at >= p_now - interval '25 minutes'
  ) then
    v_failing := array_append(v_failing, 'keepwarm');
  end if;
  if v_backup and not exists (
    select 1 from public.ops_heartbeats where name = 'backup' and at >= p_now - interval '26 hours'
  ) then
    v_failing := array_append(v_failing, 'backup');
  end if;
  -- W8 0h: the laptop's mailbox check beats `mail_folders` every five minutes; a folder it could not read (or a
  -- mailbox it could not reach) beats ok false, named here until a check reads them all again.
  if exists (
    select 1 from public.ops_heartbeats
    where name = 'mail_folders' and at >= p_now - interval '30 minutes' and detail ->> 'ok' = 'false'
  ) then
    v_failing := array_append(v_failing, 'mail_folders');
  end if;
  -- W8 0g: the nightly copy to Google Drive beats `drive_copy` after the backup; a missing Drive folder beats ok false.
  if v_backup and not exists (
    select 1 from public.ops_heartbeats
    where name = 'drive_copy' and at >= p_now - interval '26 hours' and detail ->> 'ok' = 'true'
  ) then
    v_failing := array_append(v_failing, 'drive_copy');
  end if;
  -- A local job waits for the laptop by design (ruling H34 (2)); captions_waiting watches it instead.
  if exists (
    select 1 from public.jobs
    where status = 'queued' and not run_local and run_after < p_now - interval '15 minutes'
  ) then
    v_failing := array_append(v_failing, 'stale_queue');
  end if;
  if exists (
    select 1 from public.jobs
    where status = 'dead' and finished_at > p_now - interval '24 hours'
  ) then
    v_failing := array_append(v_failing, 'dead_jobs');
  end if;
  return jsonb_build_object('ok', cardinality(v_failing) = 0, 'failing', to_jsonb(v_failing));
end;
$$;

revoke execute on function public.ops_health(timestamptz) from public, anon, authenticated;
grant execute on function public.ops_health(timestamptz) to service_role;

create or replace function public.retention_delete_rows(p_key text, p_dry_run boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows text;
  v_keep interval;
  v_count int;
begin
  -- GD-03: the allow-list of plain row deletes, each with its table and filter; any other key raises, so a kept table
  -- such as audit_log can never be named here. $1 is the policy row's keep_for.
  v_rows := case p_key
    when 'rate_limits' then 'public.rate_limits where at < now() - $1'
    when 'webhook_receipts' then 'public.webhook_receipts where received_at < now() - $1'
    when 'subject_requests' then
      $r$public.subject_requests where status in ('fulfilled', 'rejected') and received_at < now() - $1$r$
    -- G16: a dead job goes with its job_events by the foreign key's cascade.
    when 'jobs_dead' then $r$public.jobs where status = 'dead' and finished_at < now() - $1$r$
    -- G16: an event goes only once no job points at it, so jobs_dead runs first.
    when 'events_processed' then
      $r$public.events e where e.processed_at is not null and e.processed_at < now() - $1
        and not exists (select 1 from public.jobs j where j.event_id = e.id)$r$
    when 'unconfirmed_subscribers' then
      'public.subscribers where confirmed_at is null and created_at < now() - $1'
    -- Ruling H15, PERF-02: pg_cron's run history.
    when 'cron_history' then 'cron.job_run_details where end_time < now() - $1'
    -- Ruling H16: the daily aggregates, by UTC day.
    when 'analytics_daily' then
      $r$public.analytics_daily where day < ((now() at time zone 'utc') - $1)::date$r$
    -- JOB-10: the claimed and requeued rows of a job still waiting, keeping its newest row of each kind.
    when 'job_wait_events' then
      $r$public.job_events je where je.kind in ('claimed', 'requeued') and je.at < now() - $1
        and exists (select 1 from public.jobs j where j.id = je.job_id and j.status in ('queued', 'failed'))
        and je.id < (select max(n.id) from public.job_events n where n.job_id = je.job_id and n.kind = je.kind)$r$
    -- Gap audit item 17: the AI staff's records. A run's approvals keep their row (run_id is set null), a message's
    -- runs keep theirs (message_id is set null); a pending approval and an unfinished run are never removed.
    when 'agent_approvals_decided' then
      $r$public.agent_approvals where state <> 'pending' and coalesce(decided_at, created_at) < now() - $1$r$
    when 'agent_runs_finished' then
      $r$public.agent_runs where state in ('done', 'failed') and finished_at < now() - $1$r$
    when 'agent_messages' then 'public.agent_messages where created_at < now() - $1'
    -- W4: an email reply names a person and quotes them, so it is deleted, not anonymised.
    when 'email_replies' then 'public.email_replies where received_at < now() - $1'
    -- W8 0h: inbound mail names a person and quotes them, so it is deleted, not anonymised.
    when 'inbound_mail' then 'public.inbound_mail where received_at < now() - $1'
  end;
  if v_rows is null then
    raise exception 'bad_request';
  end if;
  select keep_for into v_keep
  from public.retention_policies
  where key = p_key and enabled and keep_for is not null;
  if not found then
    return 0;
  end if;
  if p_dry_run then
    execute 'select count(*)::int from ' || v_rows into v_count using v_keep;
    return v_count;
  end if;
  perform set_config('mop.retention', 'on', true);
  execute 'with gone as (delete from ' || v_rows || ' returning 1) select count(*)::int from gone'
    into v_count using v_keep;
  perform set_config('mop.retention', 'off', true);
  update public.retention_policies set last_run_at = now(), last_count = v_count where key = p_key;
  return v_count;
end;
$$;

revoke execute on function public.retention_delete_rows(text, boolean) from public, anon, authenticated;
grant execute on function public.retention_delete_rows(text, boolean) to service_role;

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
    ), '[]'),
    -- W8 0h review: every email the person sent us that the mailbox check recorded.
    'inbound_mail', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.received_at)
      from public.inbound_mail m where lower(m.from_email) = v_email
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
        'inbound_mail', jsonb_array_length(v_bundle -> 'inbound_mail')
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
  v_inbound int;
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
  -- W8 0h review: the person's emails read from the mailbox keep their place and lose the address, name and words.
  update public.inbound_mail m
  set from_email = encode(sha256(convert_to(m.from_email, 'UTF8')), 'hex') || '@anonymised.invalid',
    from_name = null,
    subject = '',
    body = '',
    attachments = '{}'
  where lower(m.from_email) = v_email;
  get diagnostics v_inbound = row_count;

  update public.subject_requests r
  set status = 'fulfilled', fulfilled_at = now(), handled_by = p_actor
  where r.id = p_subject_request_id;
  v_counts := jsonb_build_object(
    'subscribers', v_subscribers,
    'inquiries', cardinality(v_inquiries),
    'contacts', cardinality(v_contacts),
    'submissions', v_submissions,
    'inbound_mail', v_inbound
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
