create or replace function public.mark_social_post_withdrawn(
  p_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.social_posts;
  v_withdrawn_at timestamptz;
begin
  -- E2E-01: a person deleted a taken-down post on the platform by hand and records it here.
  select * into v_post from public.social_posts p where p.id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_post.withdraw_required_at is null or v_post.withdrawn_at is not null then
    raise exception 'invalid_state' using errcode = '55000';
  end if;
  update public.social_posts set withdrawn_at = now() where id = p_id returning withdrawn_at into v_withdrawn_at;
  perform public.write_audit(
    p_actor, p_actor_kind, 'channels.mark_withdrawn', 'social_posts', p_id,
    jsonb_build_object('withdrawn_at', null), jsonb_build_object('withdrawn_at', v_withdrawn_at), p_request_id
  );
end;
$$;

revoke execute on function public.mark_social_post_withdrawn(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.mark_social_post_withdrawn(uuid, uuid, public.actor_kind, text) to service_role;
