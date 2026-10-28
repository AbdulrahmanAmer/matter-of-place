create or replace function public.concierge_email_delivery(p_limit int)
returns table (
  inquiry_id uuid,
  template_key text,
  status text,
  sent_at timestamptz,
  opened boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- W7 item 12: what became of the newest emails we sent to the people of inquiries (the Concierge's area), at most
  -- p_limit (capped at 50), newest first. The inquiry each answers, its template, its state and whether Resend saw it
  -- opened, decided here so the opens of many emails never meet PostgREST's row cap; never the address or the subject.
  select m.entity_id,
    m.template_key,
    m.status,
    coalesce(m.sent_at, m.created_at),
    m.resend_id is not null and exists (
      select 1 from public.email_events e
      where e.resend_email_id = m.resend_id and e.type = 'email.opened'
    )
  from public.email_messages m
  where m.entity = 'inquiry' and m.entity_id is not null and m.kind <> 'test'
  order by m.created_at desc, m.id desc
  limit least(greatest(coalesce(p_limit, 0), 0), 50);
$$;

revoke execute on function public.concierge_email_delivery(int) from public, anon, authenticated;
grant execute on function public.concierge_email_delivery(int) to service_role;
