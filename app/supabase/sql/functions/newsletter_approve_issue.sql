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
