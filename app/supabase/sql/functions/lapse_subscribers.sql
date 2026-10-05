create or replace function public.lapse_subscribers(p_grace interval default '30 days')
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  -- GG-05: asked more than p_grace ago and no click or confirm since the ask. Soft (B2 invariant 4): the row stays,
  -- archived and unsubscribed, and its hash goes, so a late click on the ask answers confirmed=0 (DL-06).
  update public.subscribers
  set archived_at = now(), unsubscribed_at = now(), confirm_token_hash = null, pending_source = null
  where repermission_sent_at < now() - p_grace
    and archived_at is null
    and unsubscribed_at is null
    and (last_engaged_at is null or last_engaged_at < repermission_sent_at);
  get diagnostics v_count = row_count;
  -- A system row (G43): no actor, no actor kind. A run that lapses nobody writes nothing.
  if v_count > 0 then
    insert into public.audit_log (actor_id, actor_kind, action, entity, entity_id, after)
    values (null, null, 'subscribers.lapse', 'subscribers', null, jsonb_build_object('count', v_count));
  end if;
  return v_count;
end;
$$;

revoke execute on function public.lapse_subscribers(interval) from public, anon, authenticated;
grant execute on function public.lapse_subscribers(interval) to service_role;
