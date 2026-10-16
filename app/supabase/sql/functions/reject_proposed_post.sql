create or replace function public.reject_proposed_post(
  p_id uuid,
  p_note text,
  p_rerender boolean,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.proposed_posts;
  v_note text := btrim(coalesce(p_note, ''));
  v_snapshot jsonb;
begin
  -- W8 item 10 (H116): a person, or Matter's key in the operator's place, sends a proposed post back with a note, or
  -- asks for its visuals to be made again. The revision keeps its snapshot, who asked and why; the proposer reads the
  -- note in its own thread. Matter's rejections name `agent:matter` in the audit trail.
  if v_note = '' then
    raise exception 'rejection_note_required' using errcode = '22023', detail = 'Say what should change.';
  end if;
  select * into v_post from public.proposed_posts p where p.id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_post.status <> 'proposed' then
    raise exception 'wrong_state' using errcode = '55000', detail = 'This post was already decided.';
  end if;
  select jsonb_build_object(
    'title', v_post.title,
    'revision', v_post.revision,
    'channels', coalesce(
      jsonb_agg(
        jsonb_build_object('channel', c.channel, 'format', c.format, 'caption', c.caption, 'media', c.media)
        order by c.channel
      ),
      '[]'::jsonb
    )
  )
  into v_snapshot
  from public.proposed_post_channels c
  where c.post_id = p_id and c.revision = v_post.revision;

  insert into public.proposed_post_revisions (post_id, revision, reason, note, asked_by, asked_by_kind, snapshot)
  values (
    p_id, v_post.revision, case when p_rerender then 'rerender' else 'rejected' end, left(v_note, 1000), p_actor,
    p_actor_kind, v_snapshot
  );
  update public.proposed_posts set status = 'rejected', rejection_note = left(v_note, 1000) where id = p_id;

  if v_post.proposer_kind = 'agent' then
    insert into public.agent_messages (thread, author_kind, author_id, author_name, body)
    values (
      v_post.proposer_agent, 'system', 'system', 'Matter of Place',
      format(
        '%s "%s" (revision %s): %s',
        case when p_rerender then 'Make the visuals again for' else 'Sent back:' end,
        left(v_post.title, 200), v_post.revision, left(v_note, 1000)
      )
    );
  end if;
  if p_actor_kind = 'agent' then
    -- The matrix lets only Matter's key decide among keys (`agentRoles`, as `assets.reject`): the one agent account
    -- holding `admin`. `write_audit` checks a person's roles, so this row is written as `reject_asset` writes it.
    if not exists (
      select 1 from public.user_roles r
      where r.user_id = p_actor and r.actor_kind = 'agent' and r.role = 'admin' and r.disabled_at is null
    ) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    insert into public.audit_log (actor_id, actor_kind, action, entity, entity_id, before, after, request_id, note)
    values (
      p_actor, p_actor_kind,
      case when p_rerender then 'channels.proposed_rerender' else 'channels.proposed_reject' end,
      'proposed_posts', p_id,
      jsonb_build_object('status', v_post.status), jsonb_build_object('status', 'rejected'), p_request_id,
      'agent:matter'
    );
  else
    perform public.write_audit(
      p_actor, p_actor_kind,
      case when p_rerender then 'channels.proposed_rerender' else 'channels.proposed_reject' end,
      'proposed_posts', p_id,
      jsonb_build_object('status', v_post.status), jsonb_build_object('status', 'rejected'), p_request_id
    );
  end if;
  return v_post.revision;
end;
$$;

revoke execute on function public.reject_proposed_post(uuid, text, boolean, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.reject_proposed_post(uuid, text, boolean, uuid, public.actor_kind, text)
  to service_role;
