create or replace function public.cancel_social_post(
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
begin
  -- Invariant 2: a cancelled post is failed with `cancelled`; a job still waiting for it ends skipped.
  select * into v_post from public.social_posts p where p.id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_post.status <> 'scheduled' then
    raise exception 'wrong_state' using errcode = '55000';
  end if;
  update public.social_posts set status = 'failed', error = 'cancelled' where id = p_id;
  perform public.write_audit(
    p_actor, p_actor_kind, 'channels.cancel', 'social_posts', p_id,
    jsonb_build_object('status', v_post.status, 'error', v_post.error),
    jsonb_build_object('status', 'failed', 'error', 'cancelled'),
    p_request_id
  );
end;
$$;

revoke execute on function public.cancel_social_post(uuid, uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.cancel_social_post(uuid, uuid, public.actor_kind, text) to service_role;
