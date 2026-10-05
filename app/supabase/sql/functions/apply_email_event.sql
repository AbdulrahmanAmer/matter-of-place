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
