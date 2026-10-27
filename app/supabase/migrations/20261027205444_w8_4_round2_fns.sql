-- down: re-run bun run db:fn workforce_decide social_inbox_reply_begin social_inbox_reply_result social_inbox_propose social_inbox_record delete_subject from the previous commit of supabase/sql/functions/workforce_decide.sql, supabase/sql/functions/social_inbox_reply_begin.sql, supabase/sql/functions/social_inbox_reply_result.sql, supabase/sql/functions/social_inbox_propose.sql, supabase/sql/functions/social_inbox_record.sql, supabase/sql/functions/delete_subject.sql
set lock_timeout = '5s';

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
  -- W8 item 4 round 2: a reply to an Instagram comment or message is outward social, so a person approves it, as a post
  -- (approve_proposed_post), for the 60 days of human approval. Matter or the system may still decline one.
  if p_decision = 'approved' and v_row.action = 'reply_social'
    and (p_actor is null or p_actor_kind is distinct from 'human')
  then
    raise exception 'manual_approval' using errcode = '42501', detail = 'A person approves a reply on Instagram.';
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
  -- by the approval, only after a person approved it, above); a declined one leaves the comment unanswered, as ignored.
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

create or replace function public.social_inbox_reply_begin(p_approval_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval public.agent_approvals%rowtype;
  v_row public.social_inbox%rowtype;
  v_window timestamptz;
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
    -- `since` lets the job tell a send still inside its lease from one that never came back.
    return jsonb_build_object('state', v_row.reply_state, 'inbox_id', v_row.id, 'since', v_row.updated_at);
  end if;
  -- Round 2: outward social needs a person (workforce_decide refuses any other approval); a reply approved without one
  -- is refused here too, in fixed words, before any write.
  if v_approval.decided_by is null then
    return jsonb_build_object(
      'state', 'refuse', 'inbox_id', v_row.id, 'reason', 'No person approved this reply: no write was made.'
    );
  end if;
  -- Round 2: Instagram takes a reply to a message only within 24 hours of the person's latest message in it.
  if v_row.kind = 'message' then
    select max(s.received_at) + interval '24 hours' into v_window
    from public.social_inbox s
    where s.kind = 'message' and s.thread_graph_id = v_row.thread_graph_id;
    if v_window is null or v_window <= now() then
      return jsonb_build_object(
        'state', 'refuse', 'inbox_id', v_row.id,
        'reason', 'The 24-hour reply window closed: no write was made.'
      );
    end if;
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
  -- answers the row; `refused` (no write was made), `failed` (Graph said no) and `unknown` (a send that began and
  -- never came back, or Graph's transient answer to the write) leave it unanswered and keep the reason. Each outcome is
  -- said in Matter's thread in fixed words with the reason, never the comment's words. A row already sent is never
  -- changed again; a refused or failed one takes a new proposal (social_inbox_propose).
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
    -- Round 2: the reason is one of the job's or begin's fixed lines (posting off, Instagram off in Channels, no
    -- person, the 24-hour window), never outside text.
    when 'refused' then format(
      'Not sent: the approved reply to %s (inbox %s). %s',
      v_where, p_inbox_id,
      left(coalesce(nullif(btrim(p_error), ''), 'Posting is switched off here, so no write was made.'), 500)
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
  v_row public.social_inbox%rowtype;
  v_limit integer;
  v_approval uuid;
begin
  -- W8 item 4: the Social colleague's reply to one comment or message, filed by the laptop runner
  -- (scripts/workforce/social-inbox.ts) as a `reply_social` proposal in Approvals, and the row marked `proposed`, in
  -- one transaction. The row's id comes from the runner's triage record, never from the colleague's words, and the
  -- content must name the same row. One proposal per row: a row already proposed, answered or ignored is refused,
  -- except one whose approved reply was refused or failed with no write made, which takes a new proposal (round 2).
  if p_inbox_id is null or p_agent_id is null or p_content is null
    or jsonb_typeof(p_content) <> 'object'
    or p_content ->> 'inbox_id' is distinct from p_inbox_id::text
    or coalesce(btrim(p_content ->> 'body'), '') = ''
    or coalesce(btrim(p_content_hash), '') = ''
  then
    raise exception 'bad_request';
  end if;
  select * into v_row from public.social_inbox where id = p_inbox_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if not (
    v_row.state = 'new' or (v_row.state = 'proposed' and coalesce(v_row.reply_state, '') in ('refused', 'failed'))
  ) then
    raise exception 'wrong_state';
  end if;
  -- Round 2: Instagram's own limits, a comment of 2,200 characters and a message of 1,000.
  v_limit := case when v_row.kind = 'comment' then 2200 else 1000 end;
  if char_length(p_content ->> 'body') > v_limit then
    raise exception 'reply_too_long' using detail = format('Instagram takes %s characters here.', v_limit);
  end if;
  insert into public.agent_approvals (agent_id, run_id, action, summary, content, content_hash)
  values (
    p_agent_id, p_run_id, 'reply_social',
    left(coalesce(nullif(btrim(p_summary), ''), 'A reply on Instagram'), 300), p_content, p_content_hash
  )
  returning id into v_approval;
  update public.social_inbox
  set state = 'proposed', approval_id = v_approval, reply_state = null, reply_error = null, updated_at = now()
  where id = p_inbox_id;
  return v_approval;
end;
$$;

revoke execute on function public.social_inbox_propose(uuid, uuid, uuid, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.social_inbox_propose(uuid, uuid, uuid, text, jsonb, text) to service_role;

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
  -- Round 2: at most this many wakes of Social per read and per UTC day from Instagram; the rest are recorded `new`
  -- without waking, for a person on the Channels screen.
  c_read_cap constant integer := 10;
  c_day_cap constant integer := 50;
  v_woken integer := 0;
  v_today integer;
  v_held_read integer := 0;
  v_held_day integer := 0;
begin
  -- W8 item 4: one read of Instagram comments or messages (the `read_social_inbox` job, its answers parsed in
  -- src/server/channels/meta-inbox.ts). Each item is recorded once by its Graph id: an id already held, or one that is
  -- a reply we sent, is skipped. A new row emits social.inbox_received, which names the row only and wakes the Social
  -- colleague through the triage (W8 0a, 0b), within the wake caps above, so a first read's backlog or a flood never
  -- wakes more than the cap. A comment on one of our Instagram posts is tied to its social_posts row.
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
      v_new := v_new + 1;
      -- A body with no letters (emoji alone) is recorded and wakes no one. The read sets `letters` with a Unicode
      -- letter test (meta-inbox.ts), as `[[:alpha:]]` under a C collation knows ASCII letters only.
      if not coalesce((v_item ->> 'letters')::boolean, coalesce(v_item ->> 'body', '') ~ '[[:alpha:]]') then
        continue;
      end if;
      if v_today is null then
        select count(*)::integer into v_today from public.events e
        where e.type = 'social.inbox_received' and e.at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
      end if;
      if v_today + v_woken >= c_day_cap then
        v_held_day := v_held_day + 1;
      elsif v_woken >= c_read_cap then
        v_held_read := v_held_read + 1;
      else
        perform public.emit_event(
          'social.inbox_received', 'social_inbox', v_id, jsonb_build_object('inbox_id', v_id, 'kind', v_kind)
        );
        v_woken := v_woken + 1;
      end if;
    end if;
  end loop;
  -- Said once: per read for the read cap, once a UTC day for the daily cap. Counts only, never a comment's words.
  if v_held_read > 0 then
    insert into public.agent_messages (thread, author_kind, author_id, author_name, body)
    values ('matter', 'system', 'system', 'Matter of Place', format(
      'Instagram: %s more comments or messages were recorded without waking Social (at most %s a read). They wait on Social posts.',
      v_held_read, c_read_cap
    ));
  end if;
  if v_held_day > 0 and not exists (
    select 1 from public.agent_messages m
    where m.thread = 'matter' and m.author_kind = 'system'
      and m.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
      and m.body like 'Instagram: the daily limit of%'
  ) then
    insert into public.agent_messages (thread, author_kind, author_id, author_name, body)
    values ('matter', 'system', 'system', 'Matter of Place', format(
      'Instagram: the daily limit of %s wakes for Social is reached. New comments and messages are recorded without waking anyone until tomorrow (UTC) and wait on Social posts.',
      c_day_cap
    ));
  end if;
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

drop function if exists public.delete_subject(p_subject_request_id uuid, p_actor uuid, p_actor_kind public.actor_kind, p_request_id text);

create or replace function public.delete_subject(
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
  v_contacts uuid[];
  v_inquiries uuid[];
  v_subscribers int;
  v_submissions int;
  v_inbound int;
  v_handle text := lower(nullif(btrim(ltrim(btrim(coalesce(p_instagram_handle, '')), '@')), ''));
  v_social int := 0;
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
  -- W8 item 4 round 2: the Instagram handle the person names (staff enter it on the request) deletes that handle's
  -- comments and messages; deleted, not anonymised, as retention does, since a body quotes the person.
  if v_handle is not null then
    delete from public.social_inbox s where lower(s.author_handle) = v_handle;
    get diagnostics v_social = row_count;
  end if;

  update public.subject_requests r
  set status = 'fulfilled', fulfilled_at = now(), handled_by = p_actor
  where r.id = p_subject_request_id;
  v_counts := jsonb_build_object(
    'subscribers', v_subscribers,
    'inquiries', cardinality(v_inquiries),
    'contacts', cardinality(v_contacts),
    'submissions', v_submissions,
    'inbound_mail', v_inbound,
    'social_inbox', v_social
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

revoke execute on function public.delete_subject(uuid, uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.delete_subject(uuid, uuid, public.actor_kind, text, text) to service_role;
