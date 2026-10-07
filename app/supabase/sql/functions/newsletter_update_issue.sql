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
