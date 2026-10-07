-- down:
--   drop function public.assets_received(uuid, uuid, public.actor_kind, text),
--     public.request_assets(uuid, text, uuid, public.actor_kind, text),
--     public.accept_submission(uuid, uuid, public.actor_kind, text),
--     public.decline_submission(uuid, uuid, text, uuid, public.actor_kind, text),
--     public.submission_event_payload(public.submissions),
--     public.assert_agent_daily_cap(uuid, public.actor_kind, text);
set lock_timeout = '5s';

create or replace function public.assert_agent_daily_cap(
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_group text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actions text[];
  v_limit integer;
  v_count integer;
begin
  -- B7 invariant 3 (SEC-11): an agent makes at most `<group>_per_day` of the group's actions per UTC day. The kind is
  -- the stored one (DB-04): `p_actor_kind` is the caller's claim and is never read.
  v_actions := case p_group
    when 'decisions' then array['submissions.decline', 'submissions.accept']
    when 'publish' then array['properties.publish', 'stories.publish']
  end;
  if v_actions is null then
    raise exception 'invalid_key';
  end if;
  if not exists (
    select 1 from public.user_roles r where r.user_id = p_actor and r.actor_kind = 'agent'
  ) then
    return;
  end if;
  -- Two parallel calls of one agent count one after the other, so both cannot pass on the last free slot.
  perform pg_advisory_xact_lock(hashtext(p_actor::text));
  select (s.value ->> (p_group || '_per_day'))::integer
  into v_limit
  from public.settings s
  where s.key = 'agent_daily_limits';
  select count(*)
  into v_count
  from public.audit_log a
  where a.actor_id = p_actor
    and a.at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
    and a.action = any (v_actions);
  if v_count >= v_limit then
    raise exception 'agent_daily_limit';
  end if;
end;
$$;

revoke execute on function public.assert_agent_daily_cap(uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.assert_agent_daily_cap(uuid, public.actor_kind, text) to service_role;

create or replace function public.submission_event_payload(p_submission public.submissions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  -- The keys every decision event carries (B7 Contract, events emitted): the request, the tier its package buys and
  -- its market slug. ASSUMED: a package of "Not sure yet" buys no tier and reads as Editorial, which no recipe
  -- condition can name.
  select jsonb_build_object(
    'submission_id', p_submission.id,
    'tier', coalesce(public.payment_tier(p_submission.package), 'Editorial'),
    'market', lower(replace(p_submission.state::text, ' ', '-'))
  )
$$;

revoke execute on function public.submission_event_payload(public.submissions) from public, anon, authenticated;
grant execute on function public.submission_event_payload(public.submissions) to service_role;

create or replace function public.decline_submission(
  p_submission_id uuid,
  p_reason_id uuid,
  p_note text,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.submissions;
  v_after public.submissions;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  -- B7 invariants 1, 3 and 5: Under Review to Declined, decided under the row lock, counted against an agent's daily
  -- decisions, audited and announced in one transaction. The event's recipe sends the decline letter.
  select * into v_before from public.submissions s where s.id = p_submission_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_before.workflow_state <> 'Under Review' then
    raise exception 'wrong_state';
  end if;
  if not exists (select 1 from public.decline_reasons r where r.id = p_reason_id and r.enabled) then
    raise exception 'validation';
  end if;
  perform public.assert_agent_daily_cap(p_actor, p_actor_kind, 'decisions');
  update public.submissions s
  set workflow_state = 'Declined',
    decline_reason_id = p_reason_id,
    decline_note = v_note,
    reviewed_by = p_actor,
    reviewed_at = now()
  where s.id = p_submission_id
  returning * into v_after;
  perform public.write_audit(
    p_actor, p_actor_kind, 'submissions.decline', 'submission', p_submission_id, to_jsonb(v_before),
    to_jsonb(v_after), p_request_id
  );
  return public.emit_event(
    'submission.declined', 'submission', p_submission_id,
    public.submission_event_payload(v_after)
      || jsonb_strip_nulls(jsonb_build_object('decline_reason_id', p_reason_id, 'note', v_note)),
    p_actor
  );
end;
$$;

revoke execute on function public.decline_submission(uuid, uuid, text, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.decline_submission(uuid, uuid, text, uuid, public.actor_kind, text) to service_role;

create or replace function public.accept_submission(
  p_submission_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.submissions;
  v_after public.submissions;
begin
  -- B7 invariants 1, 3 and 5: Under Review to Accepted, decided under the row lock, counted against an agent's daily
  -- decisions, audited and announced in one transaction. B6 issues the invoice from here.
  select * into v_before from public.submissions s where s.id = p_submission_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_before.workflow_state <> 'Under Review' then
    raise exception 'wrong_state';
  end if;
  perform public.assert_agent_daily_cap(p_actor, p_actor_kind, 'decisions');
  update public.submissions s
  set workflow_state = 'Accepted', accepted_by = p_actor, accepted_at = now()
  where s.id = p_submission_id
  returning * into v_after;
  perform public.write_audit(
    p_actor, p_actor_kind, 'submissions.accept', 'submission', p_submission_id, to_jsonb(v_before),
    to_jsonb(v_after), p_request_id
  );
  return public.emit_event(
    'submission.accepted', 'submission', p_submission_id, public.submission_event_payload(v_after), p_actor
  );
end;
$$;

revoke execute on function public.accept_submission(uuid, uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.accept_submission(uuid, uuid, public.actor_kind, text) to service_role;

create or replace function public.request_assets(
  p_submission_id uuid,
  p_note text,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.submissions;
  v_after public.submissions;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  -- B7 invariants 1 and 5: Under Review or Accepted to Awaiting Assets. The note says what is needed; the event carries
  -- it, and B5's `awaiting_assets` letter reads it as `assets_note`.
  if v_note is null then
    raise exception 'invalid_key';
  end if;
  select * into v_before from public.submissions s where s.id = p_submission_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_before.workflow_state not in ('Under Review', 'Accepted') then
    raise exception 'wrong_state';
  end if;
  update public.submissions s
  set workflow_state = 'Awaiting Assets'
  where s.id = p_submission_id
  returning * into v_after;
  perform public.write_audit(
    p_actor, p_actor_kind, 'submissions.request_assets', 'submission', p_submission_id, to_jsonb(v_before),
    to_jsonb(v_after), p_request_id, v_note
  );
  return public.emit_event(
    'submission.awaiting_assets', 'submission', p_submission_id,
    public.submission_event_payload(v_after) || jsonb_build_object('note', v_note),
    p_actor
  );
end;
$$;

revoke execute on function public.request_assets(uuid, text, uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.request_assets(uuid, text, uuid, public.actor_kind, text) to service_role;

create or replace function public.assets_received(
  p_submission_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns public.submission_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.submissions;
  v_after public.submissions;
begin
  -- B7 invariant 5 (ASSUMED): the material arrived. Back to Accepted when the request was accepted before, else to
  -- Under Review. Audit only: no catalog event and no letter.
  select * into v_before from public.submissions s where s.id = p_submission_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_before.workflow_state <> 'Awaiting Assets' then
    raise exception 'wrong_state';
  end if;
  update public.submissions s
  set workflow_state = case when v_before.accepted_at is null then 'Under Review' else 'Accepted' end::public.submission_state
  where s.id = p_submission_id
  returning * into v_after;
  perform public.write_audit(
    p_actor, p_actor_kind, 'submissions.assets_received', 'submission', p_submission_id, to_jsonb(v_before),
    to_jsonb(v_after), p_request_id
  );
  return v_after.workflow_state;
end;
$$;

revoke execute on function public.assets_received(uuid, uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.assets_received(uuid, uuid, public.actor_kind, text) to service_role;
