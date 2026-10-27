create or replace function public.social_inbox_reply_begin(p_approval_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval public.agent_approvals%rowtype;
  v_row public.social_inbox%rowtype;
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
    return jsonb_build_object('state', v_row.reply_state, 'inbox_id', v_row.id);
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
