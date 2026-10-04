create or replace function public.upsert_subscriber(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(p ->> 'email');
  v_source text := p ->> 'source';
  v_markets text[] := array(select jsonb_array_elements_text(coalesce(p -> 'markets', '[]'::jsonb)));
  v_hash text := p ->> 'confirm_token_hash';
  v_sealed text := p ->> 'sealed_token';
  v_row public.subscribers;
  v_id uuid;
  v_lapsed boolean;
  v_unconfirmed boolean;
  v_newsletter_for_interest boolean;
begin
  insert into public.subscribers (email, source, markets, confirm_token_hash)
  values (v_email, v_source, v_markets, v_hash)
  on conflict ((lower(email))) do nothing
  returning id into v_id;
  -- G12, G20: every call that stores a fresh hash emits the sealed token for the confirmation email, in this transaction.
  if v_id is not null then
    if v_sealed is not null then
      perform public.emit_event(
        'subscriber.created', 'subscriber', v_id,
        jsonb_build_object('subscriber_id', v_id, 'sealed_token', v_sealed), null
      );
    end if;
    return v_id;
  end if;

  select * into v_row from public.subscribers s where lower(s.email) = v_email for update;
  -- DL-06, in order. An unsubscribed or archived address confirms again; until then it is unconfirmed.
  v_lapsed := v_row.unsubscribed_at is not null or v_row.archived_at is not null;
  v_unconfirmed := v_lapsed or v_row.confirmed_at is null;
  -- A Place Notes signup for an address confirmed for market interest only waits for its own click.
  v_newsletter_for_interest := not v_unconfirmed
    and v_row.source like 'interest:%'
    and v_source not like 'interest:%';
  update public.subscribers s
  set markets = array(select distinct m from unnest(v_row.markets || v_markets) m order by m),
    confirmed_at = case when v_lapsed then null else s.confirmed_at end,
    resend_contact_id = case when v_lapsed then null else s.resend_contact_id end,
    source = case
      when v_unconfirmed and v_row.source like 'interest:%' and v_source not like 'interest:%' then v_source
      else s.source
    end,
    pending_source = case when v_newsletter_for_interest then v_source else s.pending_source end,
    confirm_token_hash = case
      when v_unconfirmed or v_newsletter_for_interest then v_hash
      else s.confirm_token_hash
    end
  where s.id = v_row.id;
  if (v_unconfirmed or v_newsletter_for_interest) and v_sealed is not null then
    perform public.emit_event(
      'subscriber.created', 'subscriber', v_row.id,
      jsonb_build_object('subscriber_id', v_row.id, 'sealed_token', v_sealed), null
    );
  end if;
  return v_row.id;
end;
$$;

revoke execute on function public.upsert_subscriber(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_subscriber(jsonb) to service_role;
