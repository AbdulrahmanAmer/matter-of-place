-- down: re-run bun run db:fn spend_client_credit account_properties account_invoices account_credits account_reports account_add_photos from the previous commit of supabase/sql/functions/spend_client_credit.sql, supabase/sql/functions/account_properties.sql, supabase/sql/functions/account_invoices.sql, supabase/sql/functions/account_credits.sql, supabase/sql/functions/account_reports.sql, supabase/sql/functions/account_add_photos.sql
set lock_timeout = '5s';

create or replace function public.spend_client_credit(
  p_submission_id uuid,
  p_amount numeric,
  p_reason text,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns table (payment_id uuid, event_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact uuid;
  v_package public.exposure_package;
  v_balance integer;
  v_payment uuid;
  v_event uuid;
begin
  -- W6 item 8 (ruling H137): a Five Features credit is spent on one accepted request of the contact that holds it. The
  -- waiver is `record_waiver` (ruling H18, invariant 12): no invoice, no number, no mail. The ledger row is written in the
  -- same transaction, so a credit is never used without its waiver nor waived without its credit.
  select s.contact_id, s.package into v_contact, v_package
  from public.submissions s where s.id = p_submission_id;
  if not found then
    raise exception 'not_found';
  end if;
  -- A credit buys a Five Features property: another package, or a request with no contact, has no credit to spend.
  if v_contact is null or v_package <> 'Five Features' then
    raise exception 'wrong_state';
  end if;
  -- One spender at a time per contact, so two requests accepted together cannot both use the last credit.
  perform 1 from public.contacts c where c.id = v_contact for update;
  select coalesce(sum(cc.quantity), 0) into v_balance from public.client_credits cc where cc.contact_id = v_contact;
  if v_balance < 1 then
    raise exception 'no_credit';
  end if;
  select w.payment_id, w.event_id into v_payment, v_event
  from public.record_waiver(
    p_submission_id, 'Five Features', p_amount, p_reason, p_actor, p_actor_kind, p_request_id
  ) w;
  insert into public.client_credits (contact_id, kind, quantity, payment_id, submission_id, note)
  values (v_contact, 'used', -1, v_payment, p_submission_id, p_reason);
  return query select v_payment, v_event;
end;
$$;

revoke execute on function public.spend_client_credit(
  uuid, numeric, text, uuid, public.actor_kind, text
) from public, anon, authenticated;
grant execute on function public.spend_client_credit(
  uuid, numeric, text, uuid, public.actor_kind, text
) to service_role;

create or replace function public.account_properties(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contact public.contacts;
begin
  -- W6 item 8, rulings H119 and H137: the signed-in person's requests with the dates their timeline needs and the path
  -- of the live page, through the same mapping as `account_room`. Null when no contact matches. The fixed field list
  -- leaves out every staff column (notes, the decline note and reason, reviewer ids, address hashes).
  select * into v_contact from public.contacts c where c.id = app.contact_of(p_user);
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'name', v_contact.name,
    'email', v_contact.email,
    'properties', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'address', s.address,
          'city', s.city,
          'state', s.state,
          'package', s.package,
          'workflow_state', s.workflow_state,
          'received_at', s.received_at,
          'reviewed_at', s.reviewed_at,
          'accepted_at', s.accepted_at,
          'activated_at', s.activated_at,
          'published_at', p.published_at,
          -- The photographs on the request, and whether more can be added: until it is activated (account_add_photos).
          'photos', (select count(*) from public.submission_media m where m.submission_id = s.id),
          'can_add_photos', s.workflow_state in (
            'Submitted', 'Under Review', 'Accepted', 'Awaiting Assets', 'Invoice Issued'
          ),
          -- The page a visitor can open: only a published property has one (a takedown archives it).
          'live_path', case when p.editorial_state = 'published' then '/property/' || p.slug end
        )
        order by s.received_at desc, s.id
      )
      from public.submissions s
      left join public.properties p on p.id = s.property_id
      where s.contact_id = v_contact.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.account_properties(uuid) from public, anon, authenticated;
grant execute on function public.account_properties(uuid) to service_role;

create or replace function public.account_invoices(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contact public.contacts;
begin
  -- W6 item 8, rulings H119 and H137: the signed-in person's invoices and waivers, newest first. A voided invoice was
  -- withdrawn in error and is not shown. Left out: `notes` (a staff reason), the invoice snapshot, who issued or marked
  -- it, and the Stripe reference. `credit` is true for a waiver that spent a Five Features credit.
  select * into v_contact from public.contacts c where c.id = app.contact_of(p_user);
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'name', v_contact.name,
    'email', v_contact.email,
    'invoices', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pay.id,
          'address', s.address,
          'city', s.city,
          'product', pay.product,
          'amount', pay.amount,
          'currency', pay.currency,
          'status', pay.status,
          'invoice_number', pay.invoice_number,
          'issued_at', pay.issued_at,
          'due_at', pay.due_at,
          'paid_at', pay.paid_at,
          'credit', pay.status = 'waived' and exists (
            select 1 from public.client_credits cc where cc.payment_id = pay.id and cc.kind = 'used'
          )
        )
        order by coalesce(pay.issued_at, pay.created_at) desc, pay.id
      )
      from public.payments pay
      join public.submissions s on s.id = pay.submission_id
      where s.contact_id = v_contact.id and pay.status <> 'void'
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.account_invoices(uuid) from public, anon, authenticated;
grant execute on function public.account_invoices(uuid) to service_role;

create or replace function public.account_credits(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contact public.contacts;
begin
  -- W6 item 8, rulings H119 and H137: the Five Features ledger of the signed-in person. `balance` is what is left (the
  -- sum of the rows), `purchased` and `used` the totals behind it. An entry names the request a credit was used for,
  -- never the staff reason written on its waiver.
  select * into v_contact from public.contacts c where c.id = app.contact_of(p_user);
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'name', v_contact.name,
    'email', v_contact.email,
    'balance', (select coalesce(sum(cc.quantity), 0) from public.client_credits cc where cc.contact_id = v_contact.id),
    'purchased', (
      select coalesce(sum(cc.quantity), 0) from public.client_credits cc
      where cc.contact_id = v_contact.id and cc.kind = 'purchased'
    ),
    'used', (
      select coalesce(-sum(cc.quantity), 0) from public.client_credits cc
      where cc.contact_id = v_contact.id and cc.kind = 'used'
    ),
    'entries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', cc.id,
          'kind', cc.kind,
          'quantity', cc.quantity,
          'created_at', cc.created_at,
          'address', s.address,
          'city', s.city
        )
        order by cc.created_at desc, cc.id
      )
      from public.client_credits cc
      left join public.submissions s on s.id = cc.submission_id
      where cc.contact_id = v_contact.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.account_credits(uuid) from public, anon, authenticated;
grant execute on function public.account_credits(uuid) to service_role;

create or replace function public.account_reports(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contact public.contacts;
  v_rolled date;
begin
  -- W6 item 8, rulings H119 and H137: results for each property that came from the signed-in person's requests. Page
  -- views are the rolled-up days of `analytics_daily` plus the raw events after the last rolled day, so a day is
  -- counted once; inquiries are counts only (the sender, the address and the message never leave `inquiries`). The
  -- weekly rows are the figures the campaign report email states, the 12 newest weeks of the property's latest campaign.
  select * into v_contact from public.contacts c where c.id = app.contact_of(p_user);
  if not found then
    return null;
  end if;
  select max(d.day) into v_rolled from public.analytics_daily d where d.event = 'property_view';
  return jsonb_build_object(
    'name', v_contact.name,
    'email', v_contact.email,
    'properties', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'title', p.title,
          'city', p.city,
          'live_path', case when p.editorial_state = 'published' then '/property/' || p.slug end,
          'package', k.package,
          'starts_on', k.starts_on,
          'ends_on', k.ends_on,
          'page_views', (
            select coalesce(sum(d.events), 0) from public.analytics_daily d
            where d.event = 'property_view' and d.path = '/property/' || p.slug
          ) + (
            select count(*) from public.analytics_events e
            where e.event = 'property_view' and e.path = '/property/' || p.slug
              and (v_rolled is null or e.occurred_at >= (v_rolled + 1)::timestamp at time zone 'utc')
          ),
          'inquiries', (
            select count(*) from public.inquiries i
            where i.subject_kind = 'property' and i.subject_slug = p.slug
          ),
          'inquiries_30d', (
            select count(*) from public.inquiries i
            where i.subject_kind = 'property' and i.subject_slug = p.slug and i.received_at >= now() - interval '30 days'
          ),
          'weeks', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'period_start', r.period_start,
                'period_end', r.period_end,
                'impressions', r.impressions,
                'reach', r.reach,
                'clicks', r.clicks,
                'video_views', r.video_views,
                'ctr', r.ctr
              )
              order by r.period_start desc
            )
            from (
              select * from public.campaign_reports cr where cr.campaign_id = k.id
              order by cr.period_start desc limit 12
            ) r
          ), '[]'::jsonb)
        )
        order by s.received_at desc, s.id
      )
      from public.submissions s
      join public.properties p on p.id = s.property_id
      left join lateral (
        select c.id, c.package, c.starts_on, c.ends_on from public.campaigns c
        where c.property_id = p.id order by c.created_at desc, c.id limit 1
      ) k on true
      where s.contact_id = v_contact.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.account_reports(uuid) from public, anon, authenticated;
grant execute on function public.account_reports(uuid) to service_role;

create or replace function public.account_add_photos(p_user uuid, p_submission_id uuid, p_media jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact uuid := app.contact_of(p_user);
  v_state public.submission_state;
  v_next integer;
  v_result jsonb;
begin
  -- W6 item 8 (phase 2), ruling H137: photographs added to an open request by the person it belongs to, the way the
  -- submit form declares them: a row first (the same limits as `create_submission`), then the browser puts each file at
  -- its signed path, then the `reconcile` job settles it. One to ten at a time, so one call signs them all.
  if jsonb_typeof(p_media) is distinct from 'array' or jsonb_array_length(p_media) not between 1 and 10 then
    raise exception 'validation' using errcode = '22023', detail = 'one to ten photographs at a time';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_media) e
    where e ->> 'type' is null
      or e ->> 'type' not in ('image/jpeg', 'image/png', 'image/heic', 'image/webp')
      or coalesce(btrim(e ->> 'name'), '') = ''
      or char_length(e ->> 'name') > 255
      or (case when e ->> 'size' ~ '^[0-9]{1,8}$' then (e ->> 'size')::bigint end) is null
      or (case when e ->> 'size' ~ '^[0-9]{1,8}$' then (e ->> 'size')::bigint end) > 26214400
  ) then
    raise exception 'validation' using errcode = '22023', detail = 'unsupported photograph';
  end if;
  -- The person's own request only; `contact_of` is null for a session that is no contact's, which matches nothing.
  select s.workflow_state into v_state
  from public.submissions s
  where s.id = p_submission_id and s.contact_id = v_contact
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- Open: before the request is activated. Activation copies its photographs to the property, so a later one would
  -- never reach the page; from then on the team handles them.
  if v_state not in ('Submitted', 'Under Review', 'Accepted', 'Awaiting Assets', 'Invoice Issued') then
    raise exception 'wrong_state';
  end if;
  select coalesce(max(m.sort_order), -1) + 1 into v_next
  from public.submission_media m where m.submission_id = p_submission_id;
  -- The browser matches each file by its position in the payload, never by its name (FE-04).
  with entries as (
    select e.value as entry, (e.ordinality - 1)::int as position, gen_random_uuid() as media_id
    from jsonb_array_elements(p_media) with ordinality e
  ),
  stored as (
    insert into public.submission_media as m (id, submission_id, name, bytes, storage_path, sort_order)
    select x.media_id, p_submission_id, x.entry ->> 'name', (x.entry ->> 'size')::bigint,
      p_submission_id || '/' || x.media_id || '.' || case x.entry ->> 'type'
        when 'image/jpeg' then 'jpg'
        when 'image/png' then 'png'
        when 'image/heic' then 'heic'
        else 'webp'
      end,
      v_next + x.position
    from entries x
    returning m.id, m.storage_path
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object('media_id', st.id, 'index', en.position, 'storage_path', st.storage_path)
      order by en.position
    ),
    '[]'::jsonb
  )
  into v_result
  from stored st join entries en on en.media_id = st.id;
  return v_result;
end;
$$;

revoke execute on function public.account_add_photos(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.account_add_photos(uuid, uuid, jsonb) to service_role;
