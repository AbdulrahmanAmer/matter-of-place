create or replace function public.newsletter_audience_members(p_audience text)
returns table (id uuid, email text, resend_contact_id text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_market text;
begin
  -- Invariant 2: confirmed, still subscribed, not archived, not anonymised, not suppressed, and Place Notes consent
  -- (an interest signup is not, B3b invariant 7). A market audience also needs the market; the keys mirror
  -- MARKET_AUDIENCE in src/server/newsletter/audience.ts (G15).
  if p_audience <> 'place-notes' then
    v_market := case p_audience
      when 'market-ca' then 'california'
      when 'market-ny' then 'new-york'
      when 'market-fl' then 'florida'
    end;
    if v_market is null then
      raise exception 'unknown_audience' using errcode = '22023';
    end if;
  end if;
  return query
  select s.id, s.email, s.resend_contact_id
  from public.subscribers s
  where s.confirmed_at is not null
    and s.unsubscribed_at is null
    and s.archived_at is null
    and s.email not like '%.invalid'
    and s.source not like 'interest:%'
    and not exists (select 1 from public.email_suppressions x where x.email = lower(s.email))
    and (v_market is null or v_market = any (s.markets))
  order by s.email;
end;
$$;

revoke execute on function public.newsletter_audience_members(text) from public, anon, authenticated;
grant execute on function public.newsletter_audience_members(text) to service_role;
