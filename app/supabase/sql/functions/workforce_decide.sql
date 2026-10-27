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
