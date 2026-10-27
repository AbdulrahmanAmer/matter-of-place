-- down: re-run bun run db:fn social_inbox_record social_inbox_propose social_inbox_reply_begin social_inbox_reply_result workforce_decide retention_delete_rows from the previous commit of supabase/sql/functions/social_inbox_record.sql, supabase/sql/functions/social_inbox_propose.sql, supabase/sql/functions/social_inbox_reply_begin.sql, supabase/sql/functions/social_inbox_reply_result.sql, supabase/sql/functions/workforce_decide.sql, supabase/sql/functions/retention_delete_rows.sql
set lock_timeout = '5s';

create or replace function public.social_inbox_record(
  p_items jsonb,
  p_cursor_key text,
  p_read_until timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_kind text;
  v_id uuid;
  v_post uuid;
  v_new integer := 0;
begin
  -- W8 item 4: one read of Instagram comments or messages (the `read_social_inbox` job, its answers parsed in
  -- src/server/channels/meta-inbox.ts). Each item is recorded once by its Graph id: an id already held, or one that is
  -- a reply we sent, is skipped. A new row emits social.inbox_received, which names the row only and wakes the Social
  -- colleague through the triage (W8 0a, 0b). A comment on one of our Instagram posts is tied to its social_posts row.
  -- The cursor moves forward only, in the same transaction, so a failed write never skips an item.
  if p_cursor_key is null or p_cursor_key not in ('instagram_comments', 'instagram_messages')
    or p_items is null or jsonb_typeof(p_items) <> 'array'
  then
    raise exception 'bad_request';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_kind := v_item ->> 'kind';
    if v_kind is null or v_kind not in ('comment', 'message')
      or coalesce(btrim(v_item ->> 'graph_id'), '') = ''
      or coalesce(btrim(v_item ->> 'thread_graph_id'), '') = ''
      or (v_item ->> 'received_at') is null
    then
      raise exception 'bad_request';
    end if;
    if exists (select 1 from public.social_inbox where reply_graph_id = v_item ->> 'graph_id') then
      continue;
    end if;
    v_post := null;
    if v_kind = 'comment' then
      select p.id into v_post
      from public.social_posts p
      where p.channel = 'instagram' and p.remote_id = v_item ->> 'thread_graph_id'
      order by p.posted_at desc nulls last
      limit 1;
    end if;
    v_id := null;
    insert into public.social_inbox (
      channel, kind, graph_id, thread_graph_id, parent_graph_id, social_post_id, author_handle, body, received_at
    )
    values (
      'instagram',
      v_kind,
      left(v_item ->> 'graph_id', 200),
      left(v_item ->> 'thread_graph_id', 200),
      left(nullif(btrim(coalesce(v_item ->> 'parent_graph_id', '')), ''), 200),
      v_post,
      left(coalesce(v_item ->> 'author_handle', ''), 100),
      left(coalesce(v_item ->> 'body', ''), 4000),
      (v_item ->> 'received_at')::timestamptz
    )
    on conflict (graph_id) do nothing
    returning id into v_id;
    if v_id is not null then
      perform public.emit_event(
        'social.inbox_received', 'social_inbox', v_id, jsonb_build_object('inbox_id', v_id, 'kind', v_kind)
      );
      v_new := v_new + 1;
    end if;
  end loop;
  if p_read_until is not null then
    insert into public.social_inbox_cursors (key, read_until, read_at)
    values (p_cursor_key, p_read_until, now())
    on conflict (key) do update
    set read_until = greatest(public.social_inbox_cursors.read_until, excluded.read_until), read_at = now();
  end if;
  return v_new;
end;
$$;

revoke execute on function public.social_inbox_record(jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.social_inbox_record(jsonb, text, timestamptz) to service_role;

create or replace function public.social_inbox_propose(
  p_inbox_id uuid,
  p_agent_id uuid,
  p_run_id uuid,
  p_summary text,
  p_content jsonb,
  p_content_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
  v_approval uuid;
begin
  -- W8 item 4: the Social colleague's reply to one comment or message, filed by the laptop runner
  -- (scripts/workforce/social-inbox.ts) as a `reply_social` proposal in Approvals, and the row marked `proposed`, in
  -- one transaction. The row's id comes from the runner's triage record, never from the colleague's words, and the
  -- content must name the same row. One proposal per row: a row already proposed, answered or ignored is refused.
  if p_inbox_id is null or p_agent_id is null or p_content is null
    or jsonb_typeof(p_content) <> 'object'
    or p_content ->> 'inbox_id' is distinct from p_inbox_id::text
    or coalesce(btrim(p_content ->> 'body'), '') = ''
    or coalesce(btrim(p_content_hash), '') = ''
  then
    raise exception 'bad_request';
  end if;
  select state into v_state from public.social_inbox where id = p_inbox_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_state <> 'new' then
    raise exception 'wrong_state';
  end if;
  insert into public.agent_approvals (agent_id, run_id, action, summary, content, content_hash)
  values (
    p_agent_id, p_run_id, 'reply_social',
    left(coalesce(nullif(btrim(p_summary), ''), 'A reply on Instagram'), 300), p_content, p_content_hash
  )
  returning id into v_approval;
  update public.social_inbox
  set state = 'proposed', approval_id = v_approval, updated_at = now()
  where id = p_inbox_id;
  return v_approval;
end;
$$;

revoke execute on function public.social_inbox_propose(uuid, uuid, uuid, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.social_inbox_propose(uuid, uuid, uuid, text, jsonb, text) to service_role;

create or replace function public.social_inbox_reply_begin(p_approval_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval public.agent_approvals%rowtype;
  v_row public.social_inbox%rowtype;
begin
  -- W8 item 4: the `send_social_reply` job asks this before any Graph write. It answers `send` with what to send only
  -- once per approved reply: the row is marked `sending` in the same statement, so a rerun of the job (a retry, a lost
  -- lease) is answered with the state already reached and never sends twice. A reply that is not an approved
  -- `reply_social`, or whose row is gone, is answered `void`.
  select * into v_approval from public.agent_approvals where id = p_approval_id;
  if not found or v_approval.action <> 'reply_social' or v_approval.state <> 'approved' then
    return jsonb_build_object('state', 'void');
  end if;
  select * into v_row from public.social_inbox where approval_id = p_approval_id for update;
  if not found then
    return jsonb_build_object('state', 'void');
  end if;
  if v_row.reply_state is not null then
    return jsonb_build_object('state', v_row.reply_state, 'inbox_id', v_row.id);
  end if;
  update public.social_inbox set reply_state = 'sending', updated_at = now() where id = v_row.id;
  return jsonb_build_object(
    'state', 'send',
    'inbox_id', v_row.id,
    'kind', v_row.kind,
    'graph_id', v_row.graph_id,
    'thread_graph_id', v_row.thread_graph_id,
    -- A person's edit in Approvals is the version that was approved (workforce_decide).
    'body', coalesce(v_approval.edited_content ->> 'body', v_approval.content ->> 'body', '')
  );
end;
$$;

revoke execute on function public.social_inbox_reply_begin(uuid) from public, anon, authenticated;
grant execute on function public.social_inbox_reply_begin(uuid) to service_role;

create or replace function public.social_inbox_reply_result(
  p_inbox_id uuid,
  p_outcome text,
  p_reply_graph_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.social_inbox%rowtype;
  v_where text;
begin
  -- W8 item 4: what became of one approved reply (the `send_social_reply` job). `sent` keeps the reply's Graph id and
  -- answers the row; `refused` (posting is off here, no write was made), `failed` (Graph said no) and `unknown` (a
  -- send that began and never came back) leave it unanswered and keep the reason. Each outcome is said in Matter's
  -- thread in fixed words with the reason, never the comment's words. A row already sent is never changed again.
  if p_outcome is null or p_outcome not in ('sent', 'refused', 'failed', 'unknown')
    or (p_outcome = 'sent' and coalesce(btrim(p_reply_graph_id), '') = '')
  then
    raise exception 'bad_request';
  end if;
  select * into v_row from public.social_inbox where id = p_inbox_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_row.reply_state = 'sent' then
    raise exception 'wrong_state';
  end if;
  if p_outcome = 'sent' then
    update public.social_inbox
    set state = 'answered', reply_state = 'sent', reply_graph_id = left(p_reply_graph_id, 200), reply_error = null,
      replied_at = now(), updated_at = now()
    where id = p_inbox_id;
  else
    update public.social_inbox
    set reply_state = p_outcome, reply_error = left(coalesce(nullif(btrim(p_error), ''), p_outcome), 1000),
      updated_at = now()
    where id = p_inbox_id;
  end if;
  v_where := case when v_row.kind = 'comment' then 'an Instagram comment' else 'an Instagram message' end;
  insert into public.agent_messages (thread, author_kind, author_id, author_name, body)
  values ('matter', 'system', 'system', 'Matter of Place', case p_outcome
    when 'sent' then format('Sent: the approved reply to %s (inbox %s).', v_where, p_inbox_id)
    when 'refused' then format(
      'Not sent: the approved reply to %s (inbox %s). Posting is switched off here, so no write was made.',
      v_where, p_inbox_id
    )
    when 'unknown' then format(
      'Not known: the approved reply to %s (inbox %s) began and did not come back. Check Instagram before sending it again.',
      v_where, p_inbox_id
    )
    else format(
      'Not sent: the approved reply to %s (inbox %s). %s',
      v_where, p_inbox_id, left(coalesce(nullif(btrim(p_error), ''), 'Instagram refused it.'), 500)
    )
  end);
end;
$$;

revoke execute on function public.social_inbox_reply_result(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.social_inbox_reply_result(uuid, text, text, text) to service_role;

create or replace function public.workforce_decide(
  p_id uuid,
  p_decision text,
  p_content_hash text,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_reason text default null,
  p_edited_body text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.agent_approvals%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_edited text := nullif(trim(coalesce(p_edited_body, '')), '');
  v_trigger text;
  v_lesson text;
  v_target uuid;
  v_version integer;
begin
  -- W1 invariant 3: a person's decision on one proposal; an approval holds only for the exact content the person saw.
  if p_decision not in ('approved', 'rejected') then
    raise exception 'validation';
  end if;
  -- An edit is an approval of the person's own version; a decline carries no edit.
  if p_decision = 'rejected' and v_edited is not null then
    raise exception 'validation';
  end if;
  select * into v_row from public.agent_approvals where id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_row.state <> 'pending' then
    raise exception 'wrong_state';
  end if;
  if p_decision = 'approved' and p_content_hash is distinct from v_row.content_hash then
    raise exception 'version_conflict';
  end if;
  update public.agent_approvals
  set state = p_decision,
      decided_by = case when p_actor_kind = 'human' then p_actor end,
      decided_at = now(),
      reason = left(v_reason, 1000),
      edited_content = case
        when v_edited is null then null
        else jsonb_set(v_row.content, '{body}', to_jsonb(left(v_edited, 20000)))
      end
  where id = p_id;

  -- W2 step 6: the decision teaches the colleague who drafted it. A decline with a reason and an edit each write one
  -- lesson; the write gate refuses an empty one and skips one this colleague already holds.
  v_trigger := 'When you draft ' || case v_row.action
    when 'reply_inquiry' then 'a reply to an inquiry'
    when 'social_post' then 'a social post'
    when 'reply_social' then 'a reply on Instagram'
    when 'newsletter_issue' then 'a Place Notes issue'
    else 'a proposal (' || v_row.action || ')'
  end;
  v_lesson := case
    when p_decision = 'rejected' and v_reason is not null then
      'The operator declined "' || left(v_row.summary, 120) || '" because: ' || left(v_reason, 700)
    when p_decision = 'approved' and v_edited is not null then
      'The operator rewrote your draft before approving it. Write like the version he approved: "'
        || left(v_edited, 700) || '"'
  end;
  if v_lesson is not null and not exists (
    select 1 from public.agent_lessons l
    where l.agent_id = v_row.agent_id and l.status = 'active' and lower(l.action) = lower(v_lesson)
  ) then
    insert into public.agent_lessons (agent_id, trigger, action, evidence_ref, source)
    values (
      v_row.agent_id, v_trigger, v_lesson, 'approval:' || p_id::text,
      case when p_decision = 'rejected' then 'decline' else 'edit' end
    );
  end if;

  -- W2 step 6: an approved change of a colleague's instructions (proposed by Matter's weekly review) takes effect here,
  -- is versioned, and retires the lessons it promoted.
  if p_decision = 'approved' and v_row.action = 'instructions_change' then
    v_target := (v_row.content ->> 'agent_id')::uuid;
    update public.agents set instructions = left(v_row.content ->> 'instructions', 8000) where id = v_target;
    if not found then
      raise exception 'not_found';
    end if;
    select coalesce(max(version), 0) + 1 into v_version
    from public.agent_instruction_versions where agent_id = v_target;
    insert into public.agent_instruction_versions (agent_id, version, instructions, reason, approval_id)
    values (
      v_target, v_version, left(v_row.content ->> 'instructions', 8000),
      left(coalesce(nullif(v_row.content ->> 'reason', ''), v_row.summary), 1000), p_id
    );
    update public.agent_lessons set status = 'promoted'
    where id in (
      select value::uuid from jsonb_array_elements_text(coalesce(v_row.content -> 'lessons', '[]'::jsonb))
    );
  end if;

  -- Gap audit item 5: a hire that needed a person's word (proposed by a colleague other than Matter, past Matter's
  -- daily cap, or on Opus) joins the team here. No hire ever carries the hire tool.
  if p_decision = 'approved' and v_row.action = 'hire' then
    insert into public.agents (slug, name, role, instructions, model, wake_on, tools)
    values (
      v_row.content -> 'hire' ->> 'slug',
      v_row.content -> 'hire' ->> 'name',
      v_row.content -> 'hire' ->> 'role',
      left(coalesce(v_row.content -> 'hire' ->> 'instructions', ''), 8000),
      coalesce(v_row.content -> 'hire' ->> 'model', 'sonnet'),
      array(select jsonb_array_elements_text(coalesce(v_row.content -> 'hire' -> 'wake_on', '[]'::jsonb))),
      array(
        select t from jsonb_array_elements_text(coalesce(v_row.content -> 'hire' -> 'tools', '[]'::jsonb)) t
        where t <> 'hire'
      )
    );
  end if;

  -- W8 item 4: an approved reply to an Instagram comment or message is sent once by the `send_social_reply` job (keyed
  -- by the approval); a declined one leaves the comment unanswered, as ignored.
  if v_row.action = 'reply_social' then
    if p_decision = 'approved' then
      perform public.enqueue_job(
        'send_social_reply',
        jsonb_build_object('params', '{}'::jsonb, 'data', jsonb_build_object('approval_id', p_id)),
        'send_social_reply:' || p_id::text
      );
    else
      update public.social_inbox set state = 'ignored', updated_at = now()
      where approval_id = p_id and state = 'proposed';
    end if;
  end if;

  insert into public.agent_messages (thread, author_kind, author_id, author_name, body)
  values (
    'team', 'system', 'system', 'Matter of Place',
    format(
      '%s: %s%s',
      case
        when p_decision = 'rejected' then 'Declined'
        when v_edited is not null then 'Approved with changes'
        else 'Approved'
      end,
      v_row.summary,
      case when v_reason is null then '' else ' (' || left(v_reason, 300) || ')' end
    )
  );
  perform public.write_audit(
    p_actor, p_actor_kind, 'workforce.decide', 'agents', v_row.agent_id,
    null,
    jsonb_build_object('approval', p_id, 'decision', p_decision, 'edited', v_edited is not null),
    p_request_id
  );
  return p_decision;
end;
$$;

revoke execute on function public.workforce_decide(uuid, text, text, uuid, public.actor_kind, text, text, text)
  from public, anon, authenticated;
grant execute on function public.workforce_decide(uuid, text, text, uuid, public.actor_kind, text, text, text)
  to service_role;

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
    -- W8 item 4: an Instagram comment or message names a person and quotes them, so it is deleted, not anonymised.
    when 'social_inbox' then 'public.social_inbox where received_at < now() - $1'
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
