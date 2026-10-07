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
