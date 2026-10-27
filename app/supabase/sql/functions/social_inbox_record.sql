create or replace function public.social_inbox_record(
  p_items jsonb,
  p_cursor_key text,
  p_read_until timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_kind text;
  v_id uuid;
  v_post uuid;
  v_new integer := 0;
begin
  -- W8 item 4: one read of Instagram comments or messages (the `read_social_inbox` job, its answers parsed in
  -- src/server/channels/meta-inbox.ts). Each item is recorded once by its Graph id: an id already held, or one that is
  -- a reply we sent, is skipped. A new row emits social.inbox_received, which names the row only and wakes the Social
  -- colleague through the triage (W8 0a, 0b). A comment on one of our Instagram posts is tied to its social_posts row.
  -- The cursor moves forward only, in the same transaction, so a failed write never skips an item.
  if p_cursor_key is null or p_cursor_key not in ('instagram_comments', 'instagram_messages')
    or p_items is null or jsonb_typeof(p_items) <> 'array'
  then
    raise exception 'bad_request';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_kind := v_item ->> 'kind';
    if v_kind is null or v_kind not in ('comment', 'message')
      or coalesce(btrim(v_item ->> 'graph_id'), '') = ''
      or coalesce(btrim(v_item ->> 'thread_graph_id'), '') = ''
      or (v_item ->> 'received_at') is null
    then
      raise exception 'bad_request';
    end if;
    if exists (select 1 from public.social_inbox where reply_graph_id = v_item ->> 'graph_id') then
      continue;
    end if;
    v_post := null;
    if v_kind = 'comment' then
      select p.id into v_post
      from public.social_posts p
      where p.channel = 'instagram' and p.remote_id = v_item ->> 'thread_graph_id'
      order by p.posted_at desc nulls last
      limit 1;
    end if;
    v_id := null;
    insert into public.social_inbox (
      channel, kind, graph_id, thread_graph_id, parent_graph_id, social_post_id, author_handle, body, received_at
    )
    values (
      'instagram',
      v_kind,
      left(v_item ->> 'graph_id', 200),
      left(v_item ->> 'thread_graph_id', 200),
      left(nullif(btrim(coalesce(v_item ->> 'parent_graph_id', '')), ''), 200),
      v_post,
      left(coalesce(v_item ->> 'author_handle', ''), 100),
      left(coalesce(v_item ->> 'body', ''), 4000),
      (v_item ->> 'received_at')::timestamptz
    )
    on conflict (graph_id) do nothing
    returning id into v_id;
    if v_id is not null then
      perform public.emit_event(
        'social.inbox_received', 'social_inbox', v_id, jsonb_build_object('inbox_id', v_id, 'kind', v_kind)
      );
      v_new := v_new + 1;
    end if;
  end loop;
  if p_read_until is not null then
    insert into public.social_inbox_cursors (key, read_until, read_at)
    values (p_cursor_key, p_read_until, now())
    on conflict (key) do update
    set read_until = greatest(public.social_inbox_cursors.read_until, excluded.read_until), read_at = now();
  end if;
  return v_new;
end;
$$;

revoke execute on function public.social_inbox_record(jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.social_inbox_record(jsonb, text, timestamptz) to service_role;
