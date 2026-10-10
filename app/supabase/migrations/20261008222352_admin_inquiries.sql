-- down:
--   drop function public.close_inquiry(uuid, uuid, public.actor_kind, text),
--     public.forward_inquiry(uuid, uuid, public.actor_kind, text),
--     public.assign_inquiry(uuid, uuid, uuid, public.actor_kind, text),
--     public.list_inquiries(integer, public.inquiry_state, timestamptz, uuid);
--   drop index public.inquiries_list_idx;
set lock_timeout = '5s';

-- B7 step 11, screen 11: the inquiry list, assign, forward to Omnikom and close. No column is added (B2 created
-- them all, G23).

-- Invariant 17c: the list filters on the state and pages by (received_at desc, id) on this index.
create index inquiries_list_idx on public.inquiries (state, received_at desc, id);

create or replace function public.list_inquiries(
  p_limit integer,
  p_state public.inquiry_state default null,
  p_after_received_at timestamptz default null,
  p_after_id uuid default null
)
returns setof public.inquiries
language sql
stable
set search_path = ''
as $$
  -- Screen 11 (invariant 17c): one keyset page, newest first, ordered as the list index `inquiries_list_idx` is.
  select i.*
  from public.inquiries i
  where (p_state is null or i.state = p_state)
    and (
      p_after_received_at is null
      or i.received_at < p_after_received_at
      or (i.received_at = p_after_received_at and i.id > p_after_id)
    )
  order by i.received_at desc, i.id
  limit p_limit;
$$;

revoke execute on function public.list_inquiries(integer, public.inquiry_state, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.list_inquiries(integer, public.inquiry_state, timestamptz, uuid) to service_role;

create or replace function public.assign_inquiry(
  p_inquiry_id uuid,
  p_assignee uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns public.inquiry_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.inquiries;
  v_state public.inquiry_state;
begin
  -- Screen 11: the assignee is a person who may act on inquiries (the roles of `inquiries.assign`). Assigning a new
  -- inquiry moves it to in_progress; a forwarded one keeps its state. A closed inquiry is not reopened (R22).
  select * into v_before from public.inquiries i where i.id = p_inquiry_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_before.state = 'closed' then
    raise exception 'wrong_state';
  end if;
  if not exists (
    select 1
    from public.user_roles r
    join public.action_roles a on a.action = 'inquiries.assign'
    where r.user_id = p_assignee
      and r.disabled_at is null
      and r.actor_kind = 'human'
      and r.role = any (a.roles)
  ) then
    raise exception 'validation' using errcode = '22023', detail = 'Choose an editor who can act on inquiries.';
  end if;

  v_state := case when v_before.state = 'new' then 'in_progress'::public.inquiry_state else v_before.state end;
  update public.inquiries
  set assigned_to = p_assignee, state = v_state
  where id = p_inquiry_id;

  perform public.write_audit(
    p_actor, p_actor_kind, 'inquiries.assign', 'inquiry', p_inquiry_id,
    jsonb_build_object('id', p_inquiry_id, 'assigned_to', v_before.assigned_to, 'state', v_before.state),
    jsonb_build_object('id', p_inquiry_id, 'assigned_to', p_assignee, 'state', v_state),
    p_request_id
  );
  return v_state;
end;
$$;

revoke execute on function public.assign_inquiry(uuid, uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.assign_inquiry(uuid, uuid, uuid, public.actor_kind, text) to service_role;

create or replace function public.forward_inquiry(
  p_inquiry_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.inquiries;
  v_job uuid;
begin
  -- Screen 11: one more `webhook_omnikom` job, keyed `webhook_omnikom:<id>:<n>` by B8. The state stays as it is:
  -- B15's step sets `forwarded` after Omnikom answers 2xx. A closed or anonymised inquiry is not sent.
  select * into v_before from public.inquiries i where i.id = p_inquiry_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_before.state = 'closed' or v_before.anonymised_at is not null then
    raise exception 'wrong_state';
  end if;

  v_job := public.enqueue_job_manual(
    'webhook_omnikom',
    p_inquiry_id,
    jsonb_build_object('data', jsonb_build_object('inquiry_id', p_inquiry_id))
  );
  -- DB-09: no job means no forward, so the audit row is not written and nothing reports one.
  if v_job is null then
    raise exception 'enqueue_failed';
  end if;

  perform public.write_audit(
    p_actor, p_actor_kind, 'inquiries.forward', 'inquiry', p_inquiry_id,
    jsonb_build_object('id', p_inquiry_id),
    jsonb_build_object('id', p_inquiry_id, 'job_id', v_job),
    p_request_id
  );
  return v_job;
end;
$$;

revoke execute on function public.forward_inquiry(uuid, uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.forward_inquiry(uuid, uuid, public.actor_kind, text) to service_role;

create or replace function public.close_inquiry(
  p_inquiry_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns public.inquiry_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.inquiries;
begin
  -- Screen 11: any open inquiry closes, and a closed one stays closed (R22).
  select * into v_before from public.inquiries i where i.id = p_inquiry_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_before.state = 'closed' then
    raise exception 'wrong_state';
  end if;

  update public.inquiries set state = 'closed' where id = p_inquiry_id;

  perform public.write_audit(
    p_actor, p_actor_kind, 'inquiries.close', 'inquiry', p_inquiry_id,
    jsonb_build_object('id', p_inquiry_id, 'state', v_before.state),
    jsonb_build_object('id', p_inquiry_id, 'state', 'closed'),
    p_request_id
  );
  return 'closed'::public.inquiry_state;
end;
$$;

revoke execute on function public.close_inquiry(uuid, uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.close_inquiry(uuid, uuid, public.actor_kind, text) to service_role;
