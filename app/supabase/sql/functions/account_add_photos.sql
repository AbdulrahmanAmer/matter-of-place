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
