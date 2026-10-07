-- down: re-run bun run db:fn newsletter_open_draft queue_digest_add newsletter_save_draft newsletter_update_issue newsletter_approve_issue newsletter_unapprove_issue newsletter_export_subscribers newsletter_audience_members newsletter_recipient_count broadcast_recipients_since email_sent_today email_sent_month newsletter_set_audience newsletter_mark_sending newsletter_set_broadcast_id newsletter_mark_sent newsletter_set_send_error newsletter_set_metrics newsletter_set_contact newsletter_clear_contact standalone_approve_job from the previous commit of supabase/sql/functions/newsletter_open_draft.sql, supabase/sql/functions/queue_digest_add.sql, supabase/sql/functions/newsletter_save_draft.sql, supabase/sql/functions/newsletter_update_issue.sql, supabase/sql/functions/newsletter_approve_issue.sql, supabase/sql/functions/newsletter_unapprove_issue.sql, supabase/sql/functions/newsletter_export_subscribers.sql, supabase/sql/functions/newsletter_audience_members.sql, supabase/sql/functions/newsletter_recipient_count.sql, supabase/sql/functions/broadcast_recipients_since.sql, supabase/sql/functions/email_sent_today.sql, supabase/sql/functions/email_sent_month.sql, supabase/sql/functions/newsletter_set_audience.sql, supabase/sql/functions/newsletter_mark_sending.sql, supabase/sql/functions/newsletter_set_broadcast_id.sql, supabase/sql/functions/newsletter_mark_sent.sql, supabase/sql/functions/newsletter_set_send_error.sql, supabase/sql/functions/newsletter_set_metrics.sql, supabase/sql/functions/newsletter_set_contact.sql, supabase/sql/functions/newsletter_clear_contact.sql, supabase/sql/functions/standalone_approve_job.sql
set lock_timeout = '5s';

create or replace function public.newsletter_open_draft()
returns public.newsletter_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issue public.newsletter_issues;
begin
  -- The one open draft, locked, made when there is none: the next number, sent a fortnight after the last issue, else
  -- at the digest clock, else in 14 days. A concurrent maker meets the single-draft index and its draft is read.
  select * into v_issue from public.newsletter_issues i where i.status = 'draft' for update;
  if found then
    return v_issue;
  end if;
  insert into public.newsletter_issues (number, scheduled_for)
  select coalesce(max(i.number), 0) + 1,
    coalesce(
      max(i.sent_at) + interval '14 days',
      (select s.next_run_at from public.schedule_settings s where s.key = 'digest'),
      now() + interval '14 days'
    )
  from public.newsletter_issues i
  on conflict do nothing
  returning * into v_issue;
  if v_issue.id is null then
    select * into v_issue from public.newsletter_issues i where i.status = 'draft' for update;
  end if;
  return v_issue;
end;
$$;

revoke execute on function public.newsletter_open_draft() from public, anon, authenticated;

create or replace function public.queue_digest_add(p_property uuid, p_asset uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.assets;
  v_issue public.newsletter_issues;
  v_block jsonb;
  v_at int;
  v_held_revision int;
begin
  -- Invariant 1, mode `add`: the block of an approved newsletter_block asset joins the open draft, one block per
  -- property. The same asset again changes nothing; a newer revision replaces the older block in place, keeping the
  -- line a human wrote above it; an older revision is ignored. No audit row: the job's job_events trace it (G43).
  select * into v_asset
  from public.assets a
  where a.id = p_asset and a.property_id = p_property and a.kind = 'newsletter_block';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_asset.status not in ('approved', 'published') then
    raise exception 'wrong_state' using errcode = '55000';
  end if;
  if coalesce(v_asset.meta -> 'block' ->> 'title', '') = '' then
    raise exception 'asset_incomplete' using errcode = '22023';
  end if;
  -- The caps of the block schema in src/domain/newsletter.ts, so a long deck never makes the draft unreadable.
  v_block := jsonb_build_object(
    'id', 'property:' || p_property,
    'type', 'property',
    'property_id', p_property,
    'asset_id', p_asset,
    'title', left(v_asset.meta -> 'block' ->> 'title', 300),
    'deck', left(coalesce(v_asset.meta -> 'block' ->> 'deck', ''), 300)
  );

  v_issue := public.newsletter_open_draft();
  select b.ordinality - 1, a.revision into v_at, v_held_revision
  from jsonb_array_elements(v_issue.blocks) with ordinality b (value, ordinality)
  left join public.assets a on a.id = (b.value ->> 'asset_id')::uuid
  where b.value ->> 'type' = 'property' and b.value ->> 'property_id' = p_property::text;
  if v_at is null then
    update public.newsletter_issues set blocks = blocks || jsonb_build_array(v_block) where id = v_issue.id;
  elsif coalesce(v_held_revision, 0) < v_asset.revision then
    update public.newsletter_issues
    set blocks = jsonb_set(blocks, array[v_at::text], (blocks -> v_at) || (v_block - 'id'))
    where id = v_issue.id;
  end if;
  return v_issue.id;
end;
$$;

revoke execute on function public.queue_digest_add(uuid, uuid) from public, anon, authenticated;
grant execute on function public.queue_digest_add(uuid, uuid) to service_role;

create or replace function public.newsletter_save_draft(
  p_blocks jsonb,
  p_subject text,
  p_preheader text,
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
  v_old public.newsletter_issues;
  v_new public.newsletter_issues;
begin
  -- Creates the single draft or replaces the open one's blocks, subject and preheader with what `queue_digest`
  -- merged. `queue_digest` passes no actor, so its audit row is a system row (G43).
  if jsonb_typeof(p_blocks) is distinct from 'array' then
    raise exception 'validation' using errcode = '22023';
  end if;
  v_old := public.newsletter_open_draft();
  update public.newsletter_issues
  set blocks = p_blocks, subject = p_subject, preheader = p_preheader
  where id = v_old.id
  returning * into v_new;
  perform public.write_audit(
    p_actor, p_actor_kind, 'newsletter.build', 'newsletter_issues', v_new.id,
    jsonb_build_object(
      'id', v_old.id, 'blocks', jsonb_path_query_array(v_old.blocks, '$[*].id'), 'subject', v_old.subject,
      'preheader', v_old.preheader
    ),
    jsonb_build_object(
      'id', v_new.id, 'blocks', jsonb_path_query_array(v_new.blocks, '$[*].id'), 'subject', v_new.subject,
      'preheader', v_new.preheader
    ),
    p_request_id,
    case when p_actor is null then 'system' end
  );
  return jsonb_build_object('id', v_new.id, 'number', v_new.number);
end;
$$;

revoke execute on function public.newsletter_save_draft(jsonb, text, text, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.newsletter_save_draft(jsonb, text, text, uuid, public.actor_kind, text)
  to service_role;

create or replace function public.newsletter_update_issue(
  p_issue uuid,
  p_blocks jsonb,
  p_subject text,
  p_preheader text,
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
  v_old public.newsletter_issues;
  v_new public.newsletter_issues;
begin
  -- Screen 13's edit: blocks, subject and preheader of a draft. Approval freezes an issue (GG-06).
  if jsonb_typeof(p_blocks) is distinct from 'array' then
    raise exception 'validation' using errcode = '22023';
  end if;
  select * into v_old from public.newsletter_issues i where i.id = p_issue for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_old.status <> 'draft' then
    raise exception 'wrong_state' using errcode = '55000';
  end if;
  update public.newsletter_issues
  set blocks = p_blocks, subject = p_subject, preheader = p_preheader
  where id = p_issue
  returning * into v_new;
  perform public.write_audit(
    p_actor, p_actor_kind, 'newsletter.update', 'newsletter_issues', p_issue,
    jsonb_build_object(
      'id', p_issue, 'blocks', jsonb_path_query_array(v_old.blocks, '$[*].id'), 'subject', v_old.subject,
      'preheader', v_old.preheader
    ),
    jsonb_build_object(
      'id', p_issue, 'blocks', jsonb_path_query_array(v_new.blocks, '$[*].id'), 'subject', v_new.subject,
      'preheader', v_new.preheader
    ),
    p_request_id
  );
  return to_jsonb(v_new);
end;
$$;

revoke execute on function public.newsletter_update_issue(uuid, jsonb, text, text, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.newsletter_update_issue(uuid, jsonb, text, text, uuid, public.actor_kind, text)
  to service_role;

create or replace function public.newsletter_approve_issue(
  p_issue uuid,
  p_send_at timestamptz,
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
  v_old public.newsletter_issues;
  v_new public.newsletter_issues;
  v_data jsonb;
begin
  -- Invariant 3: only a human approves; write_audit checks the kind as stored (DB-04). Approving an approved issue
  -- reschedules it: the jobs of the previous approval are cancelled and a new pair is keyed with the new count
  -- (invariants 6 and 11).
  if p_actor is null or p_actor_kind is distinct from 'human' then
    raise exception 'human_only' using errcode = '42501';
  end if;
  select * into v_old from public.newsletter_issues i where i.id = p_issue for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_old.status not in ('draft', 'approved') then
    raise exception 'wrong_state' using errcode = '55000';
  end if;
  if jsonb_array_length(v_old.blocks) = 0 then
    raise exception 'issue_empty' using errcode = '22023';
  end if;
  update public.newsletter_issues
  set status = 'approved',
    approved_by = p_actor,
    scheduled_for = coalesce(p_send_at, now()),
    approval_count = approval_count + 1,
    send_error = null
  where id = p_issue
  returning * into v_new;

  perform public.cancel_job(j.id, p_actor, 'newsletter_reapproved')
  from public.jobs j
  where j.idempotency_key in (
    'newsletter_send:' || p_issue || ':' || v_old.approval_count,
    'newsletter_preview:' || p_issue || ':' || v_old.approval_count
  );
  v_data := jsonb_build_object(
    'params', '{}'::jsonb,
    'data', jsonb_build_object('issue_id', p_issue, 'approval_count', v_new.approval_count)
  );
  perform public.enqueue_job(
    'newsletter_send', v_data, 'newsletter_send:' || p_issue || ':' || v_new.approval_count,
    p_run_after => v_new.scheduled_for, p_max_attempts => 12
  );
  perform public.enqueue_job(
    'newsletter_preview', v_data, 'newsletter_preview:' || p_issue || ':' || v_new.approval_count,
    p_run_after => greatest(v_new.scheduled_for - interval '24 hours', now())
  );

  perform public.write_audit(
    p_actor, p_actor_kind, 'newsletter.approve', 'newsletter_issues', p_issue,
    jsonb_build_object(
      'id', p_issue, 'status', v_old.status, 'scheduled_for', v_old.scheduled_for,
      'approval_count', v_old.approval_count
    ),
    jsonb_build_object(
      'id', p_issue, 'status', v_new.status, 'scheduled_for', v_new.scheduled_for,
      'approval_count', v_new.approval_count
    ),
    p_request_id
  );
  return to_jsonb(v_new);
end;
$$;

revoke execute on function public.newsletter_approve_issue(uuid, timestamptz, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.newsletter_approve_issue(uuid, timestamptz, uuid, public.actor_kind, text)
  to service_role;

create or replace function public.newsletter_unapprove_issue(
  p_issue uuid,
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
  v_old public.newsletter_issues;
  v_new public.newsletter_issues;
begin
  -- Back to draft for editing. The count moves on, so a send or preview job of the old approval that already runs
  -- exits stale; the queued ones are cancelled here. One draft at a time: refused while another is open.
  select * into v_old from public.newsletter_issues i where i.id = p_issue for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_old.status <> 'approved' then
    raise exception 'wrong_state' using errcode = '55000';
  end if;
  if exists (select 1 from public.newsletter_issues i where i.status = 'draft') then
    raise exception 'draft_open' using errcode = '55000';
  end if;
  update public.newsletter_issues
  set status = 'draft', approved_by = null, approval_count = approval_count + 1
  where id = p_issue
  returning * into v_new;
  perform public.cancel_job(j.id, p_actor, 'newsletter_unapproved')
  from public.jobs j
  where j.idempotency_key in (
    'newsletter_send:' || p_issue || ':' || v_old.approval_count,
    'newsletter_preview:' || p_issue || ':' || v_old.approval_count
  );
  perform public.write_audit(
    p_actor, p_actor_kind, 'newsletter.unapprove', 'newsletter_issues', p_issue,
    jsonb_build_object('id', p_issue, 'status', v_old.status, 'approval_count', v_old.approval_count),
    jsonb_build_object('id', p_issue, 'status', v_new.status, 'approval_count', v_new.approval_count),
    p_request_id
  );
  return to_jsonb(v_new);
end;
$$;

revoke execute on function public.newsletter_unapprove_issue(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.newsletter_unapprove_issue(uuid, uuid, public.actor_kind, text) to service_role;

create or replace function public.newsletter_export_subscribers(
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns table (
  email text,
  markets text,
  source text,
  status text,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  -- The CSV of screen 13: every subscriber that is not archived or anonymised. The audit row holds the count only,
  -- never an address (G27).
  select count(*)::int into v_count
  from public.subscribers s
  where s.archived_at is null and s.email not like '%.invalid';
  perform public.write_audit(
    p_actor, p_actor_kind, 'newsletter.subscribers_export', 'subscribers', null, null,
    jsonb_build_object('count', v_count), p_request_id
  );
  return query
  select s.email,
    array_to_string(s.markets, ';'),
    s.source,
    case
      when s.unsubscribed_at is not null then 'unsubscribed'
      when s.confirmed_at is not null then 'confirmed'
      else 'pending'
    end,
    s.confirmed_at,
    s.unsubscribed_at
  from public.subscribers s
  where s.archived_at is null and s.email not like '%.invalid'
  order by s.created_at, s.id;
end;
$$;

revoke execute on function public.newsletter_export_subscribers(uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.newsletter_export_subscribers(uuid, public.actor_kind, text) to service_role;

create or replace function public.newsletter_audience_members(p_audience text)
returns table (id uuid, email text, resend_contact_id text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_market text;
begin
  -- Invariant 2: confirmed, still subscribed, not archived, not anonymised, not suppressed, and Place Notes consent
  -- (an interest signup is not, B3b invariant 7). A market audience also needs the market; the keys mirror
  -- MARKET_AUDIENCE in src/server/newsletter/audience.ts (G15).
  if p_audience <> 'place-notes' then
    v_market := case p_audience
      when 'market-ca' then 'california'
      when 'market-ny' then 'new-york'
      when 'market-fl' then 'florida'
    end;
    if v_market is null then
      raise exception 'unknown_audience' using errcode = '22023';
    end if;
  end if;
  return query
  select s.id, s.email, s.resend_contact_id
  from public.subscribers s
  where s.confirmed_at is not null
    and s.unsubscribed_at is null
    and s.archived_at is null
    and s.email not like '%.invalid'
    and s.source not like 'interest:%'
    and not exists (select 1 from public.email_suppressions x where x.email = lower(s.email))
    and (v_market is null or v_market = any (s.markets))
  order by s.email;
end;
$$;

revoke execute on function public.newsletter_audience_members(text) from public, anon, authenticated;
grant execute on function public.newsletter_audience_members(text) to service_role;

create or replace function public.newsletter_recipient_count(p_audience text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  -- Invariant 5: the size of a broadcast before it is sent, for the quota gate and screen 13.
  select count(*)::int from public.newsletter_audience_members(p_audience);
$$;

revoke execute on function public.newsletter_recipient_count(text) from public, anon, authenticated;
grant execute on function public.newsletter_recipient_count(text) to service_role;

create or replace function public.broadcast_recipients_since(p_since timestamptz)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  -- Invariant 5: the recipients of the Place Notes issues and standalone emails sent since p_since. A dry run's
  -- broadcast id starts with `dry_` and never counts toward the cap (invariant 6).
  select (
    coalesce((
      select sum((i.metrics ->> 'recipients')::int)
      from public.newsletter_issues i
      where i.sent_at >= p_since and not coalesce(starts_with(i.resend_broadcast_id, 'dry_'), false)
    ), 0)
    + coalesce((
      select sum((a.meta -> 'broadcast' ->> 'recipients')::int)
      from public.assets a
      where a.kind = 'standalone_email'
        and (a.meta -> 'broadcast' ->> 'sent_at')::timestamptz >= p_since
        and not coalesce(starts_with(a.meta -> 'broadcast' ->> 'id', 'dry_'), false)
    ), 0)
  )::int;
$$;

revoke execute on function public.broadcast_recipients_since(timestamptz) from public, anon, authenticated;
grant execute on function public.broadcast_recipients_since(timestamptz) to service_role;

create or replace function public.email_sent_today()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  -- Invariant 5: every row Resend accepted in the current UTC day, whatever happened to it since, plus the recipients
  -- of the broadcasts sent that day (B11), so the daily cap sees a Place Notes issue.
  select (
    select count(*)::int
    from public.email_messages
    where sent_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
  ) + public.broadcast_recipients_since(date_trunc('day', now() at time zone 'utc') at time zone 'utc');
$$;

revoke execute on function public.email_sent_today() from public, anon, authenticated;
grant execute on function public.email_sent_today() to service_role;

create or replace function public.email_sent_month()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  -- Invariant 5: every row Resend accepted in the current UTC month, plus the recipients of the broadcasts sent that
  -- month (B11).
  select (
    select count(*)::int
    from public.email_messages
    where sent_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
  ) + public.broadcast_recipients_since(date_trunc('month', now() at time zone 'utc') at time zone 'utc');
$$;

revoke execute on function public.email_sent_month() from public, anon, authenticated;
grant execute on function public.email_sent_month() to service_role;

create or replace function public.newsletter_set_audience(p_key text, p_audience_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- `ensureAudience` stores the Resend id of an audience here once it exists. No screen edits settings.resend.
  update public.settings
  set value = jsonb_set(
    value || jsonb_build_object('audiences', coalesce(value -> 'audiences', '{}'::jsonb)),
    array['audiences', p_key],
    to_jsonb(p_audience_id)
  )
  where key = 'resend';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.newsletter_set_audience(text, text) from public, anon, authenticated;
grant execute on function public.newsletter_set_audience(text, text) to service_role;

create or replace function public.newsletter_mark_sending(p_issue uuid, p_approval_count int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Invariant 6: before the broadcast is created. False when the issue was unapproved or approved again since the
  -- job was made, and the send job then exits stale. A resumed job finds it already `sending`.
  update public.newsletter_issues
  set status = 'sending'
  where id = p_issue and status in ('approved', 'sending') and approval_count = p_approval_count;
  return found;
end;
$$;

revoke execute on function public.newsletter_mark_sending(uuid, int) from public, anon, authenticated;
grant execute on function public.newsletter_mark_sending(uuid, int) to service_role;

create or replace function public.newsletter_set_broadcast_id(p_issue uuid, p_broadcast_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Invariant 6, INT-10: written right after create and before send. The first id stays, so a resumed job sends the
  -- broadcast it already created.
  update public.newsletter_issues
  set resend_broadcast_id = coalesce(resend_broadcast_id, p_broadcast_id)
  where id = p_issue;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.newsletter_set_broadcast_id(uuid, text) from public, anon, authenticated;
grant execute on function public.newsletter_set_broadcast_id(uuid, text) to service_role;

create or replace function public.newsletter_mark_sent(p_issue uuid, p_recipients int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  -- Invariant 6: Resend accepted the send. Only a `sending` issue becomes `sent`.
  select i.status into v_status from public.newsletter_issues i where i.id = p_issue for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'sending' then
    raise exception 'wrong_state' using errcode = '55000';
  end if;
  update public.newsletter_issues
  set status = 'sent',
    sent_at = now(),
    send_error = null,
    metrics = metrics || jsonb_build_object('recipients', p_recipients)
  where id = p_issue;
end;
$$;

revoke execute on function public.newsletter_mark_sent(uuid, int) from public, anon, authenticated;
grant execute on function public.newsletter_mark_sent(uuid, int) to service_role;

create or replace function public.newsletter_set_send_error(p_issue uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Invariants 4 to 6: why an approved issue did not leave. The status stays, so a human can act on it.
  update public.newsletter_issues set send_error = p_error where id = p_issue;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.newsletter_set_send_error(uuid, text) from public, anon, authenticated;
grant execute on function public.newsletter_set_send_error(uuid, text) to service_role;

create or replace function public.newsletter_set_metrics(p_issue uuid, p_metrics jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- `aggregateIssueMetrics` merges its counts in. `recipients` is the send's own number and is never replaced here.
  if jsonb_typeof(p_metrics) is distinct from 'object' then
    raise exception 'validation' using errcode = '22023';
  end if;
  update public.newsletter_issues set metrics = metrics || (p_metrics - 'recipients') where id = p_issue;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.newsletter_set_metrics(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.newsletter_set_metrics(uuid, jsonb) to service_role;

create or replace function public.newsletter_set_contact(p_subscriber uuid, p_contact_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Invariant 13: `syncAudience` keeps the Resend contact id of a member it added.
  update public.subscribers set resend_contact_id = p_contact_id where id = p_subscriber;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.newsletter_set_contact(uuid, text) from public, anon, authenticated;
grant execute on function public.newsletter_set_contact(uuid, text) to service_role;

create or replace function public.newsletter_clear_contact(p_contact_id text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  -- Invariant 13: after `syncAudience` removed a contact, no subscriber row points at it.
  update public.subscribers set resend_contact_id = null where resend_contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.newsletter_clear_contact(text) from public, anon, authenticated;
grant execute on function public.newsletter_clear_contact(text) to service_role;

create or replace function public.standalone_approve_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Invariant 9: approving the standalone_email asset on screen 10 also approves the waiting standalone send of its
  -- property, in the same transaction as approve_asset. When there is no such job (Feature tier, or approved on
  -- screen 16) nothing changes.
  perform public.approve_job(j.id, new.approved_by)
  from public.jobs j
  where j.type = 'send_email'
    and j.status = 'waiting_approval'
    and j.payload -> 'params' ->> 'template' = 'standalone'
    and j.payload -> 'data' ->> 'property_id' = new.property_id::text;
  return null;
end;
$$;

revoke execute on function public.standalone_approve_job() from public, anon, authenticated;

create or replace trigger assets_standalone_approve_job
after update of status on public.assets
for each row
when (new.kind = 'standalone_email' and new.status = 'approved' and old.status <> 'approved')
execute function public.standalone_approve_job();
