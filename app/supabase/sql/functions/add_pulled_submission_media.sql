create or replace function public.add_pulled_submission_media(
  p_submission_id uuid,
  p_name text,
  p_mime text,
  p_bytes bigint,
  p_source_url text
)
returns table (media_id uuid, storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rights timestamptz;
  v_id uuid := gen_random_uuid();
  v_path text;
begin
  -- W9 item 4: a photograph a colleague pulled from the request's own listing or photography link joins the request's
  -- media the way an upload does: a row first, then the object at its path, then `mark_media_uploaded`. Only for a
  -- request whose rights are confirmed, and each keeps the address it came from.
  select s.rights_confirmed_at into v_rights from public.submissions s where s.id = p_submission_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_rights is null then
    raise exception 'wrong_state' using detail = 'The rights of this request are not confirmed.';
  end if;
  if p_mime not in ('image/jpeg', 'image/png', 'image/webp') or p_source_url !~ '^https?://' then
    raise exception 'validation';
  end if;
  v_path := p_submission_id || '/' || v_id || '.' || case p_mime
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    else 'webp'
  end;
  insert into public.submission_media (id, submission_id, name, bytes, storage_path, sort_order, source_url)
  values (
    v_id, p_submission_id, left(p_name, 200), p_bytes, v_path,
    (select coalesce(max(m.sort_order), -1) + 1 from public.submission_media m where m.submission_id = p_submission_id),
    left(p_source_url, 2000)
  );
  return query select v_id, v_path;
end;
$$;

revoke execute on function public.add_pulled_submission_media(uuid, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.add_pulled_submission_media(uuid, text, text, bigint, text) to service_role;
