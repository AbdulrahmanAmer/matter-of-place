create or replace function public.person_detail(p_contact_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contact public.contacts;
begin
  -- Screen 27 (invariant 23, S55): the person and five lists in one call, each newest first and at most 100 rows.
  -- Payments are B2's own columns, so the read needs nothing of B6.
  select * into v_contact from public.contacts c where c.id = p_contact_id;
  if not found then
    raise exception 'not_found';
  end if;
  return jsonb_build_object(
    'contact', jsonb_build_object(
      'id', v_contact.id,
      'kind', v_contact.kind,
      'name', v_contact.name,
      'email', v_contact.email,
      'phone', v_contact.phone,
      'brokerage', v_contact.brokerage,
      'notes', v_contact.notes,
      'updated_at', v_contact.updated_at
    ),
    'requests', coalesce((
      select jsonb_agg(r order by r.received_at desc, r.id)
      from (
        select s.id, s.address, s.city, s.state, s.workflow_state, s.received_at
        from public.submissions s
        where s.contact_id = p_contact_id
        order by s.received_at desc, s.id
        limit 100
      ) r
    ), '[]'::jsonb),
    'properties', coalesce((
      select jsonb_agg(r order by r.created_at desc, r.id)
      from (
        select p.id, p.title, p.slug, p.editorial_state, p.first_published_at, p.created_at
        from public.properties p
        join public.submissions s on s.id = p.submission_id
        where s.contact_id = p_contact_id
        order by p.created_at desc, p.id
        limit 100
      ) r
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(r order by r.created_at desc, r.id)
      from (
        select pay.id, pay.invoice_number, pay.product, pay.amount, pay.currency, pay.status, pay.issued_at,
          pay.paid_at, pay.created_at
        from public.payments pay
        join public.submissions s on s.id = pay.submission_id
        where s.contact_id = p_contact_id
        order by pay.created_at desc, pay.id
        limit 100
      ) r
    ), '[]'::jsonb),
    'emails', coalesce((
      select jsonb_agg(r order by r.created_at desc, r.id)
      from (
        select e.id, e.template_key, e.status, e.sent_at, e.created_at
        from public.email_messages e
        where lower(e.to_email) = lower(v_contact.email)
        order by e.created_at desc, e.id
        limit 100
      ) r
    ), '[]'::jsonb),
    'inquiries', coalesce((
      select jsonb_agg(r order by r.received_at desc, r.id)
      from (
        select i.id, i.received_at, i.intent, i.state, i.subject_title
        from public.inquiries i
        where i.subject_kind = 'property'
          and i.subject_slug in (
            select p.slug
            from public.properties p
            join public.submissions s on s.id = p.submission_id
            where s.contact_id = p_contact_id
          )
        order by i.received_at desc, i.id
        limit 100
      ) r
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.person_detail(uuid) from public, anon, authenticated;
grant execute on function public.person_detail(uuid) to service_role;
