create or replace function public.social_inbox_record(
  p_items jsonb,
  p_cursor_key text,
  p_read_until timestamptz default null,
  p_pending jsonb default null
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
  -- Round 2: at most this many wakes of Social per read and per UTC day from Instagram; the rest are recorded `new`
  -- without waking, for a person on the Channels screen.
  c_read_cap constant integer := 10;
  c_day_cap constant integer := 50;
  v_woken integer := 0;
  v_today integer;
  v_held_read integer := 0;
  v_held_day integer := 0;
begin
  -- W8 item 4: one read of Instagram comments or messages (the `read_social_inbox` job, its answers parsed in
  -- src/server/channels/meta-inbox.ts). Each item is recorded once by its Graph id: an id already held, or one that is
  -- a reply we sent, is skipped. A new row emits social.inbox_received, which names the row only and wakes the Social
  -- colleague through the triage (W8 0a, 0b), within the wake caps above, so a first read's backlog or a flood never
  -- wakes more than the cap. A comment on one of our Instagram posts is tied to its social_posts row.
  -- The cursor moves forward only, in the same transaction, so a failed write never skips an item.
  -- Round 3: one read at a time counts and spends the daily wakes, so two reads that overlap never pass the cap.
  perform pg_advisory_xact_lock(hashtext('social_inbox_record'));
  if p_cursor_key is null or p_cursor_key not in ('instagram_comments', 'instagram_messages')
    or p_items is null or jsonb_typeof(p_items) <> 'array'
    or (p_pending is not null and jsonb_typeof(p_pending) <> 'object')
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
      v_new := v_new + 1;
      -- A body with no letters (emoji alone) is recorded and wakes no one. The read sets `letters` with a Unicode
      -- letter test (meta-inbox.ts), as `[[:alpha:]]` under a C collation knows ASCII letters only.
      if not coalesce((v_item ->> 'letters')::boolean, coalesce(v_item ->> 'body', '') ~ '[[:alpha:]]') then
        continue;
      end if;
      if v_today is null then
        select count(*)::integer into v_today from public.events e
        where e.type = 'social.inbox_received' and e.at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
      end if;
      if v_today + v_woken >= c_day_cap then
        v_held_day := v_held_day + 1;
      elsif v_woken >= c_read_cap then
        v_held_read := v_held_read + 1;
      else
        perform public.emit_event(
          'social.inbox_received', 'social_inbox', v_id, jsonb_build_object('inbox_id', v_id, 'kind', v_kind)
        );
        v_woken := v_woken + 1;
      end if;
    end if;
  end loop;
  -- Said once: per read for the read cap, once a UTC day for the daily cap. Counts only, never a comment's words.
  if v_held_read > 0 then
    insert into public.agent_messages (thread, author_kind, author_id, author_name, body)
    values ('matter', 'system', 'system', 'Matter of Place', format(
      'Instagram: %s more comments or messages were recorded without waking Social (at most %s a read). They wait on Social posts.',
      v_held_read, c_read_cap
    ));
  end if;
  if v_held_day > 0 and not exists (
    select 1 from public.agent_messages m
    where m.thread = 'matter' and m.author_kind = 'system'
      and m.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
      and m.body like 'Instagram: the daily limit of%'
  ) then
    insert into public.agent_messages (thread, author_kind, author_id, author_name, body)
    values ('matter', 'system', 'system', 'Matter of Place', format(
      'Instagram: the daily limit of %s wakes for Social is reached. New comments and messages are recorded without waking anyone until tomorrow (UTC) and wait on Social posts.',
      c_day_cap
    ));
  end if;
  -- Round 3: the lists this read left part way (Graph's `after` cursors, meta-inbox.ts) replace the last read's, in the
  -- same transaction as the rows, so the next read resumes exactly where this one stopped.
  if p_read_until is not null then
    insert into public.social_inbox_cursors (key, read_until, read_at, pending)
    values (p_cursor_key, p_read_until, now(), coalesce(p_pending, '{}'::jsonb))
    on conflict (key) do update
    set read_until = greatest(public.social_inbox_cursors.read_until, excluded.read_until), read_at = now(),
      pending = coalesce(p_pending, public.social_inbox_cursors.pending);
  end if;
  return v_new;
end;
$$;

revoke execute on function public.social_inbox_record(jsonb, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.social_inbox_record(jsonb, text, timestamptz, jsonb) to service_role;
