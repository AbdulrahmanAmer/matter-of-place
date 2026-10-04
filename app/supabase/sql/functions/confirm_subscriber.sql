create or replace function public.confirm_subscriber(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- The hash alone matches (G12): a re-permission hash on a confirmed row confirms it again, and a used link matches
  -- nothing once the hash is cleared. A Place Notes source waiting on this click becomes the row's source (DL-06).
  update public.subscribers
  set confirmed_at = now(),
    confirm_token_hash = null,
    source = coalesce(pending_source, source),
    pending_source = null,
    unsubscribed_at = null,
    archived_at = null
  where confirm_token_hash = p_token_hash
  returning id into v_id;
  if v_id is not null then
    perform public.emit_event(
      'subscriber.confirmed', 'subscriber', v_id, jsonb_build_object('subscriber_id', v_id), null
    );
  end if;
  return v_id;
end;
$$;

revoke execute on function public.confirm_subscriber(text) from public, anon, authenticated;
grant execute on function public.confirm_subscriber(text) to service_role;
