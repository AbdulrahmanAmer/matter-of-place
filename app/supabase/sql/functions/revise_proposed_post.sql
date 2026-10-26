create or replace function public.revise_proposed_post(
  p_id uuid,
  p_channels jsonb,
  p_actor uuid default null,
  p_actor_kind public.actor_kind default null,
  p_request_id text default null,
  p_title text default null,
  p_proposer_agent text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.proposed_posts;
  v_revision integer;
begin
  -- W8 item 10 (H116): a rejected post comes back as its next revision with new channels; the revision sent back keeps
  -- its own rows and its snapshot in proposed_post_revisions. The runner revises for its colleague (no actor, the
  -- colleague's slug); a person or Matter's key through the admin route.
  select * into v_post from public.proposed_posts p where p.id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_post.status <> 'rejected' then
    raise exception 'wrong_state' using errcode = '55000', detail = 'Only a post that was sent back can be revised.';
  end if;
  if p_title is not null and (btrim(p_title) = '' or char_length(p_title) > 200) then
    raise exception 'validation' using errcode = '22023', detail = 'A proposed post needs a title of up to 200 characters.';
  end if;
  v_revision := v_post.revision + 1;
  update public.proposed_posts
  set status = 'proposed',
      revision = v_revision,
      rejection_note = null,
      title = coalesce(btrim(p_title), title)
  where id = p_id;
  perform public.proposed_post_put_channels(p_id, v_revision, p_channels);
  perform public.write_audit(
    p_actor, p_actor_kind, 'channels.proposed_revise', 'proposed_posts', p_id,
    jsonb_build_object('status', v_post.status, 'revision', v_post.revision),
    jsonb_build_object('status', 'proposed', 'revision', v_revision), p_request_id,
    case when p_proposer_agent is not null then 'agent:' || p_proposer_agent end
  );
  return v_revision;
end;
$$;

revoke execute on function public.revise_proposed_post(uuid, jsonb, uuid, public.actor_kind, text, text, text)
  from public, anon, authenticated;
grant execute on function public.revise_proposed_post(uuid, jsonb, uuid, public.actor_kind, text, text, text)
  to service_role;
