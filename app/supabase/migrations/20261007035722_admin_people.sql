-- down:
--   drop function public.set_contact_notes(uuid, text, timestamptz, uuid, public.actor_kind, text),
--     public.person_detail(uuid),
--     public.people_list(text, public.submitter_kind, integer, text, uuid);
set lock_timeout = '5s';

-- B7 step 5a, screens 26 and 27 (invariant 23, S55): functions only. B2 created `contacts`, `submissions.contact_id`
-- and the indexes `contacts_email_key`, `contacts_name_idx` and `submissions_contact_id_idx`.

create or replace function public.people_list(
  p_search text default null,
  p_kind public.submitter_kind default null,
  p_limit integer default 50,
  p_cursor_name text default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid,
  name text,
  kind public.submitter_kind,
  brokerage text,
  email text,
  requests integer,
  accepted integer,
  published integer,
  last_activity_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Screen 26 (invariant 23, S55): one keyset page of the people not anonymised, ordered as B2's
  -- `contacts_name_idx` is. The search text is compared with `position`, so no pattern is built from it (R44).
  select
    c.id,
    c.name,
    c.kind,
    c.brokerage,
    c.email,
    coalesce(s.requests, 0),
    coalesce(s.accepted, 0),
    coalesce(s.published, 0),
    greatest(c.updated_at, s.last_updated_at)
  from public.contacts c
  left join lateral (
    select
      count(*)::integer as requests,
      count(*) filter (where x.accepted_at is not null)::integer as accepted,
      count(p.id) filter (where p.first_published_at is not null)::integer as published,
      max(x.updated_at) as last_updated_at
    from public.submissions x
    left join public.properties p on p.submission_id = x.id
    where x.contact_id = c.id
  ) s on true
  where c.archived_at is null
    and (p_kind is null or c.kind = p_kind)
    and (
      p_search is null
      or position(lower(p_search) in lower(c.name)) > 0
      or position(lower(p_search) in lower(c.email)) > 0
      or position(lower(p_search) in lower(coalesce(c.brokerage, ''))) > 0
    )
    and (p_cursor_id is null or (lower(c.name), c.id) > (lower(p_cursor_name), p_cursor_id))
  order by lower(c.name), c.id
  limit least(greatest(coalesce(p_limit, 50), 1), 50);
$$;

revoke execute on function public.people_list(text, public.submitter_kind, integer, text, uuid)
  from public, anon, authenticated;
grant execute on function public.people_list(text, public.submitter_kind, integer, text, uuid) to service_role;

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

create or replace function public.set_contact_notes(
  p_contact_id uuid,
  p_notes text,
  p_expected_updated_at timestamptz,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.contacts;
  v_updated_at timestamptz;
begin
  -- Screen 27 (invariant 23): the internal notes on a person, saved whole. An editor who started from an older
  -- version gets `stale`, as on stories. `write_audit` stores `{"pii": "changed"}` for `notes` (B2's pii_columns).
  if p_notes is null or char_length(p_notes) > 5000 then
    raise exception 'validation';
  end if;
  select * into v_old from public.contacts c where c.id = p_contact_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale';
  end if;
  update public.contacts
  set notes = p_notes
  where id = p_contact_id
  returning updated_at into v_updated_at;
  perform public.write_audit(
    p_actor, p_actor_kind, 'people.note', 'contact', p_contact_id,
    jsonb_build_object('id', p_contact_id, 'notes', v_old.notes),
    jsonb_build_object('id', p_contact_id, 'notes', p_notes),
    p_request_id
  );
  return v_updated_at;
end;
$$;

revoke execute on function public.set_contact_notes(uuid, text, timestamptz, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.set_contact_notes(uuid, text, timestamptz, uuid, public.actor_kind, text)
  to service_role;
