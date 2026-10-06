create or replace function public.add_submission_note(
  p_submission_id uuid,
  p_text text,
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
  v_note jsonb;
begin
  -- An internal note on a request (screen 4). The text stays on the request: the audit row names the note, never its
  -- words, which may hold personal data (DB-03).
  if p_text is null or char_length(btrim(p_text)) not between 1 and 2000 then
    raise exception 'validation';
  end if;
  v_note := jsonb_build_object(
    'id', gen_random_uuid(),
    'text', btrim(p_text),
    'actor_id', p_actor,
    'actor_kind', p_actor_kind,
    'at', now()
  );
  update public.submissions
  set notes = array_append(notes, v_note)
  where id = p_submission_id;
  if not found then
    raise exception 'not_found';
  end if;
  perform public.write_audit(
    p_actor, p_actor_kind, 'submissions.note', 'submission', p_submission_id,
    null,
    jsonb_build_object('id', p_submission_id, 'note_id', v_note ->> 'id'),
    p_request_id
  );
  return v_note;
end;
$$;

revoke execute on function public.add_submission_note(uuid, text, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.add_submission_note(uuid, text, uuid, public.actor_kind, text) to service_role;
