create or replace function public.create_submission(p jsonb)
returns table (id uuid, received_at timestamptz, media jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.submissions := jsonb_populate_record(null::public.submissions, p);
  v_entries jsonb := coalesce(p -> 'media', '[]'::jsonb);
  v_address text := lower(regexp_replace(btrim(v.address), '\s+', ' ', 'g'));
  v_existing public.submissions;
  v_duplicate_of uuid;
  v_contact_id uuid;
  v_submission_id uuid;
  v_received_at timestamptz;
begin
  -- GQ-07: the same number as uploadLimits.maxFiles and the submission_media trigger.
  if jsonb_array_length(v_entries) > 40 then
    raise exception 'validation' using errcode = '22023', detail = 'more than 40 media entries';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_entries) e
    where e ->> 'type' not in ('image/jpeg', 'image/png', 'image/heic', 'image/webp') or e ->> 'type' is null
  ) then
    raise exception 'validation' using errcode = '22023', detail = 'unsupported media type';
  end if;

  -- A double click (ASSUMED: the same submitter, address and zip within 10 minutes) answers with the first request.
  select * into v_existing
  from public.submissions s
  where lower(s.submitter_email) = lower(v.submitter_email)
    and lower(regexp_replace(btrim(s.address), '\s+', ' ', 'g')) = v_address
    and s.zip = v.zip
    and s.received_at > now() - interval '10 minutes'
  order by s.received_at
  limit 1;
  if found then
    return query
    select v_existing.id, v_existing.received_at, coalesce(
      (select jsonb_agg(
          jsonb_build_object('id', m.id, 'index', m.sort_order, 'name', m.name, 'storage_path', m.storage_path)
          order by m.sort_order
        )
        from public.submission_media m
        where m.submission_id = v_existing.id),
      '[]'::jsonb
    );
    return;
  end if;

  -- Invariant 12 (GD-05): a request for the same address by the same email within 30 days points at the first one.
  select s.id into v_duplicate_of
  from public.submissions s
  where lower(s.submitter_email) = lower(v.submitter_email)
    and lower(regexp_replace(btrim(s.address), '\s+', ' ', 'g')) = v_address
    and s.received_at > now() - interval '30 days'
  order by s.received_at
  limit 1;

  -- Invariant 22 (S55): one person is one row. The kind first recorded stays; the request keeps what was typed.
  insert into public.contacts as c (kind, name, email, phone, brokerage)
  values (v.submitter_kind, v.submitter_name, lower(v.submitter_email), v.submitter_phone, v.brokerage)
  on conflict ((lower(email))) do update
  set name = excluded.name,
    phone = coalesce(excluded.phone, c.phone),
    brokerage = coalesce(excluded.brokerage, c.brokerage)
  returning c.id into v_contact_id;

  insert into public.submissions as s (
    address, city, state, zip, listing_url, source_url, price, currency, property_type, beds, baths, interior_sq_ft,
    architect, designer, year_built, year_renovated, brokerage, submitter_kind, submitter_name, submitter_email,
    submitter_phone, listed_with_agent, listing_agent_name, listing_agent_brokerage, contact_id, photography_url,
    video_url, story, significance, package, media_budget, source_path, turnstile_ok, ip_hash, rights_version,
    rights_confirmed_at, rights_ip_hash, duplicate_of
  ) values (
    v.address, v.city, v.state, v.zip, v.listing_url, v.source_url, v.price, coalesce(v.currency, 'USD'),
    v.property_type, v.beds, v.baths, v.interior_sq_ft, v.architect, v.designer, v.year_built, v.year_renovated,
    v.brokerage, v.submitter_kind, v.submitter_name, v.submitter_email, v.submitter_phone, v.listed_with_agent,
    v.listing_agent_name, v.listing_agent_brokerage, v_contact_id, v.photography_url, v.video_url, v.story,
    v.significance, v.package, v.media_budget, v.source_path, coalesce(v.turnstile_ok, false), v.ip_hash,
    v.rights_version, v.rights_confirmed_at, v.rights_ip_hash, v_duplicate_of
  )
  returning s.id, s.received_at into v_submission_id, v_received_at;

  -- G20: the event commits or rolls back with the row; the 10-minute repeat above returned before it.
  perform public.emit_event(
    'submission.received', 'submission', v_submission_id, jsonb_build_object('submission_id', v_submission_id), null
  );

  -- FE-04: the browser matches each file by its position in the payload, never by its name.
  return query
  with entries as (
    select e.value as entry, (e.ordinality - 1)::int as position, gen_random_uuid() as media_id
    from jsonb_array_elements(v_entries) with ordinality e
  ),
  stored as (
    insert into public.submission_media as m (id, submission_id, name, bytes, storage_path, sort_order)
    select x.media_id, v_submission_id, x.entry ->> 'name', (x.entry ->> 'size')::bigint,
      v_submission_id || '/' || x.media_id || '.' || case x.entry ->> 'type'
        when 'image/jpeg' then 'jpg'
        when 'image/png' then 'png'
        when 'image/heic' then 'heic'
        else 'webp'
      end,
      x.position
    from entries x
    returning m.id, m.sort_order, m.name, m.storage_path
  )
  select v_submission_id, v_received_at, coalesce(
    (select jsonb_agg(
        jsonb_build_object('id', st.id, 'index', st.sort_order, 'name', st.name, 'storage_path', st.storage_path)
        order by st.sort_order
      )
      from stored st),
    '[]'::jsonb
  );
end;
$$;

revoke execute on function public.create_submission(jsonb) from public, anon, authenticated;
grant execute on function public.create_submission(jsonb) to service_role;
