-- down: re-run bun run db:fn apply_email_event from the previous commit of supabase/sql/functions/apply_email_event.sql
set lock_timeout = '5s';

create or replace function public.apply_email_event(p jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text := p ->> 'type';
  v_email text := lower(p ->> 'to_email');
  v_at timestamptz := coalesce((p ->> 'at')::timestamptz, now());
  v_data jsonb := coalesce(p -> 'data', '{}'::jsonb);
  v_rank int;
  v_suppress text;
  v_message record;
begin
  -- Invariant 9: Resend sends every event of the account to every endpoint. A contact or broadcast event belongs here
  -- only when its audience is one of settings.resend.audiences (B11's key; without it every such event is dropped).
  if (v_type = 'contact.updated' or p ->> 'broadcast_id' is not null) and not exists (
    select 1
    from public.settings s
    cross join lateral jsonb_each_text(
      case when jsonb_typeof(s.value -> 'audiences') = 'object' then s.value -> 'audiences' else '{}'::jsonb end
    ) a
    where s.key = 'resend' and a.value = p ->> 'audience_id'
  ) then
    -- Gap audit item 22: a contact event about one of our own readers, dropped because its audience is not mapped,
    -- would leave an unsubscribe unrecorded. It is kept (without the address) and the health check counts it.
    if v_type = 'contact.updated' and v_email is not null and exists (
      select 1 from public.subscribers s where lower(s.email) = v_email
    ) then
      insert into public.audit_log (action, entity, after)
      values (
        'email.contact_event_dropped',
        'subscribers',
        jsonb_build_object(
          'audience_id', p ->> 'audience_id',
          'provider_event_id', p ->> 'provider_event_id',
          'unsubscribed', v_data -> 'unsubscribed'
        )
      );
    end if;
    return false;
  end if;

  insert into public.email_events (provider_event_id, type, resend_email_id, broadcast_id, to_email, at, data)
  values (p ->> 'provider_event_id', v_type, p ->> 'resend_email_id', p ->> 'broadcast_id', v_email, v_at, v_data)
  on conflict (provider_event_id) do nothing;
  if not found then
    return false;
  end if;

  -- Forward only: sent 1, delivered 2, bounced and complained 3. A queued, failed or skipped row never moves here.
  v_rank := case v_type
    when 'email.sent' then 1
    when 'email.delivered' then 2
    when 'email.bounced' then 3
    when 'email.complained' then 3
  end;
  if v_rank is not null then
    update public.email_messages m
    set status = substr(v_type, length('email.') + 1),
      delivered_at = case when v_type = 'email.delivered' then v_at else m.delivered_at end
    where m.resend_id = p ->> 'resend_email_id'
      and case m.status
        when 'sent' then 1
        when 'delivered' then 2
        when 'bounced' then 3
        when 'complained' then 3
      end < v_rank;
  end if;

  -- GG-05: a complaint, a permanent bounce, or the third transient bounce for one address within 30 days.
  v_suppress := case
    when v_type = 'email.complained' then 'complaint'
    when v_type = 'email.bounced' and v_data ->> 'bounce_type' = 'Permanent' then 'bounce'
    when v_type = 'email.bounced' and v_data ->> 'bounce_type' = 'Transient' and (
      select count(*)
      from public.email_events e
      where e.to_email = v_email
        and e.type = 'email.bounced'
        and e.data ->> 'bounce_type' = 'Transient'
        and e.at between v_at - interval '30 days' and v_at
    ) >= 3 then 'bounce'
  end;
  if v_suppress is not null and v_email is not null then
    insert into public.email_suppressions (email, reason, at)
    values (v_email, v_suppress, now())
    on conflict (email) do nothing;
  end if;

  -- W9 item 3: the same bounce or complaint about a request or an inquiry wakes the colleague who owns it (the daemon
  -- matches `email.bounced` to the owner of the entity). Ids only; the runner reads the address and phone itself.
  if v_suppress is not null then
    select m.id, m.template_key, m.entity, m.entity_id into v_message
    from public.email_messages m
    where m.resend_id = p ->> 'resend_email_id' and m.entity in ('submission', 'inquiry') and m.entity_id is not null;
    if found then
      perform public.emit_event(
        'email.bounced', v_message.entity, v_message.entity_id,
        jsonb_build_object(
          v_message.entity || '_id', v_message.entity_id,
          'message_id', v_message.id,
          'template', v_message.template_key,
          'reason', v_suppress,
          'bounce_type', v_data ->> 'bounce_type'
        ),
        null
      );
    end if;
  end if;

  -- Opens are not engagement (mail privacy features fire them); a click is.
  if v_type = 'email.clicked' and v_email is not null then
    update public.subscribers set last_engaged_at = now() where lower(email) = v_email;
  end if;

  -- An unsubscribe from a Place Notes issue; the cleared hash makes an older confirm link answer confirmed=0 (DL-06).
  if v_type = 'contact.updated' and v_data -> 'unsubscribed' = 'true'::jsonb and v_email is not null then
    update public.subscribers
    set unsubscribed_at = now(), confirm_token_hash = null, pending_source = null
    where lower(email) = v_email and unsubscribed_at is null;
  end if;

  return true;
end;
$$;

revoke execute on function public.apply_email_event(jsonb) from public, anon, authenticated;
grant execute on function public.apply_email_event(jsonb) to service_role;
