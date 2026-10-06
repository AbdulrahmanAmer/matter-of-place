-- down:
--   drop function public.add_submission_note(uuid, text, uuid, public.actor_kind, text),
--     public.start_review(uuid[], uuid, public.actor_kind, text),
--     public.list_submissions(integer, public.submission_state[], public.accepted_state, public.exposure_package,
--       text, boolean, timestamptz, uuid);
--   drop index public.submissions_list_idx;
--   drop view public.submission_list;
set lock_timeout = '5s';

-- B7 step 4, screen 3: the request list. No column is added (B2 created them all). `property_id` is the property
-- made from the request, by B2's unique `properties.submission_id`; it runs with the caller's rights (R20).
create view public.submission_list
with (security_invoker = true) as
select
  s.id,
  s.received_at,
  s.address,
  s.city,
  s.state,
  s.submitter_kind,
  s.submitter_name,
  s.brokerage,
  s.package,
  s.workflow_state,
  s.accepted_at,
  s.duplicate_of,
  s.turnstile_ok,
  p.id as property_id
from public.submissions s
left join public.properties p on p.submission_id = s.id;

revoke all on public.submission_list from public, anon, authenticated;
grant select on public.submission_list to service_role;

-- Invariant 17c: the list filters on the state and pages by (received_at desc, id) on this index.
create index submissions_list_idx on public.submissions (workflow_state, received_at desc, id);

create or replace function public.list_submissions(
  p_limit integer,
  p_states public.submission_state[] default null,
  p_market public.accepted_state default null,
  p_package public.exposure_package default null,
  p_search text default null,
  p_without_property boolean default false,
  p_after_received_at timestamptz default null,
  p_after_id uuid default null
)
returns setof public.submission_list
language sql
stable
set search_path = ''
as $$
  -- Screen 3 (invariant 17c): one keyset page of `submission_list`, newest first, ordered as the list index
  -- `submissions_list_idx` is. The search text arrives as a parameter, never inside a filter string (R44).
  with q as (
    select '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  )
  select l.*
  from public.submission_list l, q
  where (p_states is null or l.workflow_state = any (p_states))
    and (p_market is null or l.state = p_market)
    and (p_package is null or l.package = p_package)
    and (
      p_search is null
      or l.address ilike q.pattern
      or l.submitter_name ilike q.pattern
      or l.brokerage ilike q.pattern
    )
    -- The accepted requests still without the property made from them (screen 7, "New from request").
    and (
      not p_without_property
      or (
        l.accepted_at is not null
        and l.workflow_state in ('Accepted', 'Awaiting Assets', 'Invoice Issued', 'Scheduled')
        and l.property_id is null
      )
    )
    and (
      p_after_received_at is null
      or l.received_at < p_after_received_at
      or (l.received_at = p_after_received_at and l.id > p_after_id)
    )
  order by l.received_at desc, l.id
  limit p_limit;
$$;

revoke execute on function public.list_submissions(
  integer, public.submission_state[], public.accepted_state, public.exposure_package, text, boolean, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.list_submissions(
  integer, public.submission_state[], public.accepted_state, public.exposure_package, text, boolean, timestamptz, uuid
) to service_role;

create or replace function public.start_review(
  p_submission_ids uuid[],
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  -- B7 invariant 5: Submitted to Under Review, one request or a selection, all or none. The rows are locked in id
  -- order, so two overlapping selections wait on each other instead of deadlocking.
  if coalesce(cardinality(p_submission_ids), 0) not between 1 and 50 then
    raise exception 'validation';
  end if;
  for v_row in
    select s.id, s.workflow_state
    from public.submissions s
    where s.id = any (p_submission_ids)
    order by s.id
    for update
  loop
    if v_row.workflow_state <> 'Submitted' then
      raise exception 'wrong_state';
    end if;
    update public.submissions
    set workflow_state = 'Under Review', reviewed_by = p_actor, reviewed_at = now()
    where id = v_row.id;
    perform public.write_audit(
      p_actor, p_actor_kind, 'submissions.start_review', 'submission', v_row.id,
      jsonb_build_object('id', v_row.id, 'workflow_state', 'Submitted'),
      jsonb_build_object('id', v_row.id, 'workflow_state', 'Under Review'),
      p_request_id
    );
    v_count := v_count + 1;
  end loop;
  if v_count <> (select count(distinct x) from unnest(p_submission_ids) x) then
    raise exception 'not_found';
  end if;
  return v_count;
end;
$$;

revoke execute on function public.start_review(uuid[], uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.start_review(uuid[], uuid, public.actor_kind, text) to service_role;

create or replace function public.add_submission_note(
  p_submission_id uuid,
  p_text text,
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
  v_note jsonb;
begin
  -- An internal note on a request (screen 4). The text stays on the request: the audit row names the note, never its
  -- words, which may hold personal data (DB-03).
  if p_text is null or char_length(btrim(p_text)) not between 1 and 2000 then
    raise exception 'validation';
  end if;
  v_note := jsonb_build_object(
    'id', gen_random_uuid(),
    'text', btrim(p_text),
    'actor_id', p_actor,
    'actor_kind', p_actor_kind,
    'at', now()
  );
  update public.submissions
  set notes = array_append(notes, v_note)
  where id = p_submission_id;
  if not found then
    raise exception 'not_found';
  end if;
  perform public.write_audit(
    p_actor, p_actor_kind, 'submissions.note', 'submission', p_submission_id,
    null,
    jsonb_build_object('id', p_submission_id, 'note_id', v_note ->> 'id'),
    p_request_id
  );
  return v_note;
end;
$$;

revoke execute on function public.add_submission_note(uuid, text, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.add_submission_note(uuid, text, uuid, public.actor_kind, text) to service_role;
