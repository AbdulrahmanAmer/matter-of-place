-- down: re-run bun run db:fn email_reply_mark from the previous commit of supabase/sql/functions/email_reply_mark.sql
set lock_timeout = '5s';

create or replace function public.email_reply_mark(
  p_reply_id uuid,
  p_state text,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before text;
begin
  -- W7 item 2: a person reads a reply on the Sent emails screen and marks it: `seen` when it is opened (only from
  -- `new`), `answered` or `ignored` when it is dealt with (from any state). A mark to the state it already has changes
  -- nothing and is not audited. The audit row names the reply and its two states, never its words or its sender.
  if p_state is null or p_state not in ('seen', 'answered', 'ignored') then
    raise exception 'validation';
  end if;
  select r.state into v_before from public.email_replies r where r.id = p_reply_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_before = p_state or (p_state = 'seen' and v_before <> 'new') then
    return v_before;
  end if;
  update public.email_replies set state = p_state where id = p_reply_id;
  perform public.write_audit(
    p_actor, p_actor_kind, 'audit.reply_mark', 'email_replies', p_reply_id,
    jsonb_build_object('id', p_reply_id, 'state', v_before),
    jsonb_build_object('id', p_reply_id, 'state', p_state),
    p_request_id
  );
  return p_state;
end;
$$;

revoke execute on function public.email_reply_mark(uuid, text, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.email_reply_mark(uuid, text, uuid, public.actor_kind, text) to service_role;
