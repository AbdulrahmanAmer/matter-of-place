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
