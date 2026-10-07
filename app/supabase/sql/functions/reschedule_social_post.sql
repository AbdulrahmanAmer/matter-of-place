create or replace function public.reschedule_social_post(p_id uuid, p_scheduled_at timestamptz, p_note text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before timestamptz;
begin
  -- Invariant 3a: a temporary failure near the window end moves the post; the system writes the row (G43).
  select p.scheduled_at into v_before from public.social_posts p where p.id = p_id and p.status = 'scheduled' for update;
  if not found then
    return false;
  end if;
  update public.social_posts set scheduled_at = p_scheduled_at where id = p_id;
  perform public.write_audit(
    null, null, 'channels.reschedule', 'social_posts', p_id,
    jsonb_build_object('scheduled_at', v_before), jsonb_build_object('scheduled_at', p_scheduled_at), null, p_note
  );
  return true;
end;
$$;

revoke execute on function public.reschedule_social_post(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.reschedule_social_post(uuid, timestamptz, text) to service_role;
