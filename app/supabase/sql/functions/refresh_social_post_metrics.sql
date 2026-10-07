create or replace function public.refresh_social_post_metrics(
  p_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.social_post_status;
  v_job uuid;
begin
  -- Invariant 1: the admin never calls a platform; the reconcile job reads this one post's metrics.
  select p.status into v_status from public.social_posts p where p.id = p_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'posted' then
    raise exception 'wrong_state' using errcode = '55000';
  end if;
  v_job := public.enqueue_job_manual(
    'reconcile', p_id,
    jsonb_build_object('params', jsonb_build_object('post_ids', jsonb_build_array(p_id)), 'data', '{}'::jsonb)
  );
  -- DB-09: no job means nothing was asked, so the audit row rolls back with this raise.
  if v_job is null then
    raise exception 'enqueue_failed' using errcode = '55000';
  end if;
  perform public.write_audit(
    p_actor, p_actor_kind, 'channels.metrics_refresh', 'social_posts', p_id, null,
    jsonb_build_object('job_id', v_job), p_request_id
  );
  return v_job;
end;
$$;

revoke execute on function public.refresh_social_post_metrics(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.refresh_social_post_metrics(uuid, uuid, public.actor_kind, text) to service_role;
