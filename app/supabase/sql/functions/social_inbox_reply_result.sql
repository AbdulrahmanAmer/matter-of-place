create or replace function public.social_inbox_reply_result(
  p_inbox_id uuid,
  p_outcome text,
  p_reply_graph_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.social_inbox%rowtype;
  v_where text;
begin
  -- W8 item 4: what became of one approved reply (the `send_social_reply` job). `sent` keeps the reply's Graph id and
  -- answers the row; `refused` (posting is off here, no write was made), `failed` (Graph said no) and `unknown` (a
  -- send that began and never came back) leave it unanswered and keep the reason. Each outcome is said in Matter's
  -- thread in fixed words with the reason, never the comment's words. A row already sent is never changed again.
  if p_outcome is null or p_outcome not in ('sent', 'refused', 'failed', 'unknown')
    or (p_outcome = 'sent' and coalesce(btrim(p_reply_graph_id), '') = '')
  then
    raise exception 'bad_request';
  end if;
  select * into v_row from public.social_inbox where id = p_inbox_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_row.reply_state = 'sent' then
    raise exception 'wrong_state';
  end if;
  if p_outcome = 'sent' then
    update public.social_inbox
    set state = 'answered', reply_state = 'sent', reply_graph_id = left(p_reply_graph_id, 200), reply_error = null,
      replied_at = now(), updated_at = now()
    where id = p_inbox_id;
  else
    update public.social_inbox
    set reply_state = p_outcome, reply_error = left(coalesce(nullif(btrim(p_error), ''), p_outcome), 1000),
      updated_at = now()
    where id = p_inbox_id;
  end if;
  v_where := case when v_row.kind = 'comment' then 'an Instagram comment' else 'an Instagram message' end;
  insert into public.agent_messages (thread, author_kind, author_id, author_name, body)
  values ('matter', 'system', 'system', 'Matter of Place', case p_outcome
    when 'sent' then format('Sent: the approved reply to %s (inbox %s).', v_where, p_inbox_id)
    when 'refused' then format(
      'Not sent: the approved reply to %s (inbox %s). Posting is switched off here, so no write was made.',
      v_where, p_inbox_id
    )
    when 'unknown' then format(
      'Not known: the approved reply to %s (inbox %s) began and did not come back. Check Instagram before sending it again.',
      v_where, p_inbox_id
    )
    else format(
      'Not sent: the approved reply to %s (inbox %s). %s',
      v_where, p_inbox_id, left(coalesce(nullif(btrim(p_error), ''), 'Instagram refused it.'), 500)
    )
  end);
end;
$$;

revoke execute on function public.social_inbox_reply_result(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.social_inbox_reply_result(uuid, text, text, text) to service_role;
