create or replace function public.create_property_from_submission(
  p_submission_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.submissions;
  v_id uuid;
  v_base text;
  v_slug text;
  v_suffix integer := 1;
  v_representative uuid;
  v_after public.properties;
  v_job uuid;
begin
  -- DL-02: serialised with B6's activate_submission on the submission row; B2's unique index on
  -- properties.submission_id is the backstop.
  perform 1 from public.submissions s where s.id = p_submission_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- Idempotent: a second call returns the property and its copy job and writes nothing.
  select p.id into v_id from public.properties p where p.submission_id = p_submission_id;
  if found then
    return jsonb_build_object(
      'property_id', v_id,
      'copy_job_id', (
        select j.id from public.jobs j where j.idempotency_key = 'copy_submission_media:' || v_id::text
      )
    );
  end if;
  select * into v_sub from public.submissions s where s.id = p_submission_id;
  if v_sub.accepted_at is null or v_sub.workflow_state not in (
    'Accepted', 'Awaiting Assets', 'Invoice Issued', 'Scheduled', 'Published', 'Distribution Active', 'Completed'
  ) then
    raise exception 'wrong_state';
  end if;

  -- G62: the city slugified, then the first eight characters of the id; editable until the first publication.
  v_id := gen_random_uuid();
  v_base := btrim(left(regexp_replace(lower(v_sub.city), '[^a-z0-9]+', '-', 'g'), 100), '-');
  v_base := case when v_base = '' then '' else v_base || '-' end || left(v_id::text, 8);
  v_slug := v_base;
  while exists (select 1 from public.properties p where p.slug = v_slug)
    or exists (select 1 from public.slug_history h where h.slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_base || '-' || v_suffix::text;
  end loop;

  -- S55: an agent's request links the representative with that address (or a new one); an owner's links none.
  if v_sub.submitter_kind = 'agent' then
    select r.id into v_representative
    from public.representatives r
    where lower(r.email) = lower(v_sub.submitter_email)
    order by r.created_at, r.id
    limit 1;
    if not found then
      insert into public.representatives (name, brokerage, email, phone)
      values (v_sub.submitter_name, coalesce(v_sub.brokerage, ''), v_sub.submitter_email, v_sub.submitter_phone)
      returning id into v_representative;
    end if;
  end if;

  -- Every column the request has no value for stays null until an editor fills it (G62); B7 writes no placeholder.
  insert into public.properties (
    id, slug, title, market_slug, city, state, country, address, price, beds, baths, interior_sq_ft, year_built,
    type, architect, designer, listing_url, story, status, source, submission_id, created_by, updated_by,
    editorial_state, representative_id, presented_by_owner
  ) values (
    v_id, v_slug, v_sub.address,
    case v_sub.state when 'California' then 'california' when 'New York' then 'new-york' else 'florida' end,
    v_sub.city, v_sub.state::text, 'United States', v_sub.address, v_sub.price, v_sub.beds, v_sub.baths,
    v_sub.interior_sq_ft, v_sub.year_built, v_sub.property_type, v_sub.architect, v_sub.designer,
    v_sub.listing_url, array[v_sub.story], 'Active', 'Submission', p_submission_id, p_actor, p_actor,
    'draft', v_representative, v_sub.submitter_kind = 'owner'
  )
  returning * into v_after;

  -- Invariant 21 (a): each row takes the id of the photograph it copies, so the copy job finds its source by id.
  insert into public.property_media (id, property_id, staging_path, sort_order)
  select m.id, v_id,
    'staging/' || v_id::text || '/' || m.id::text || '.' || substring(m.storage_path from '\.([^./]+)$'),
    (row_number() over (order by m.sort_order, m.uploaded_at, m.id) - 1)::integer
  from public.submission_media m
  where m.submission_id = p_submission_id and m.uploaded_at is not null;

  perform public.write_audit(
    p_actor, p_actor_kind, 'properties.create_from_submission', 'property', v_id, null, to_jsonb(v_after),
    p_request_id
  );
  -- E2E-02, PERF-07: the photographs are copied by the job runner, never inside a request.
  v_job := public.enqueue_job(
    'copy_submission_media',
    jsonb_build_object('params', '{}'::jsonb, 'data', jsonb_build_object('property_id', v_id)),
    'copy_submission_media:' || v_id::text
  );
  return jsonb_build_object('property_id', v_id, 'copy_job_id', v_job);
end;
$$;

revoke execute on function public.create_property_from_submission(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.create_property_from_submission(uuid, uuid, public.actor_kind, text)
  to service_role;
