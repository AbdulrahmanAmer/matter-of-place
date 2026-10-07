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
