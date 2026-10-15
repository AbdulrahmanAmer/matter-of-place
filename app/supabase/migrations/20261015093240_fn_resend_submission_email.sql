-- down: re-run bun run db:fn resend_submission_email from the previous commit of supabase/sql/functions/resend_submission_email.sql
set lock_timeout = '5s';

create or replace function public.resend_submission_email(
  p_submission_id uuid,
  p_message_id uuid,
  p_email text,
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
  v_message public.email_messages;
  v_payload jsonb;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_job uuid;
begin
  -- W9 item 2: an email about a request that bounced, failed or was not sent goes again, to the corrected address.
  -- The request keeps the new address, so the send step (which reads the submitter from the request) uses it; the
  -- job is the original's payload under a fresh key `send_email:<request>:<n>`.
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_email) > 254 then
    raise exception 'validation' using detail = 'Please enter a full email address.';
  end if;
  select * into v_before from public.submissions s where s.id = p_submission_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into v_message from public.email_messages m
  where m.id = p_message_id and m.entity = 'submission' and m.entity_id = p_submission_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_message.status not in ('bounced', 'failed', 'skipped') then
    raise exception 'wrong_state' using detail = 'Only an email that bounced or was not sent can go again.';
  end if;
  if exists (select 1 from public.email_suppressions x where x.email = v_email) then
    raise exception 'wrong_state' using detail = 'This address is on the do-not-send list. Ask for another address.';
  end if;
  select j.payload into v_payload from public.jobs j where j.id = v_message.job_id;
  if v_payload is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  update public.submissions set submitter_email = v_email
  where id = p_submission_id and lower(submitter_email) is distinct from v_email;

  v_job := public.enqueue_job_manual('send_email', p_submission_id, v_payload);
  -- DB-09: no job means nothing goes again, so nothing is audited and the address change is undone with the raise.
  if v_job is null then
    raise exception 'enqueue_failed';
  end if;

  perform public.write_audit(
    p_actor, p_actor_kind, 'submissions.resend_email', 'submission', p_submission_id,
    jsonb_build_object('message_id', p_message_id),
    -- Invariant 18: no address in the audit, only whether it changed.
    jsonb_build_object(
      'message_id', p_message_id, 'template', v_message.template_key, 'job_id', v_job,
      'address_changed', v_email is distinct from lower(v_before.submitter_email)
    ),
    p_request_id
  );
  return v_job;
end;
$$;

revoke execute on function public.resend_submission_email(uuid, uuid, text, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.resend_submission_email(uuid, uuid, text, uuid, public.actor_kind, text)
  to service_role;
