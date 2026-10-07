create or replace function public.newsletter_export_subscribers(
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns table (
  email text,
  markets text,
  source text,
  status text,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  -- The CSV of screen 13: every subscriber that is not archived or anonymised. The audit row holds the count only,
  -- never an address (G27).
  select count(*)::int into v_count
  from public.subscribers s
  where s.archived_at is null and s.email not like '%.invalid';
  perform public.write_audit(
    p_actor, p_actor_kind, 'newsletter.subscribers_export', 'subscribers', null, null,
    jsonb_build_object('count', v_count), p_request_id
  );
  return query
  select s.email,
    array_to_string(s.markets, ';'),
    s.source,
    case
      when s.unsubscribed_at is not null then 'unsubscribed'
      when s.confirmed_at is not null then 'confirmed'
      else 'pending'
    end,
    s.confirmed_at,
    s.unsubscribed_at
  from public.subscribers s
  where s.archived_at is null and s.email not like '%.invalid'
  order by s.created_at, s.id;
end;
$$;

revoke execute on function public.newsletter_export_subscribers(uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.newsletter_export_subscribers(uuid, public.actor_kind, text) to service_role;
