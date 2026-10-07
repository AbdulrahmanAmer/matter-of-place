create or replace function public.activate_submission(
  p_submission_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns table (property_id uuid, event_id uuid, copy_job_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.submissions;
  v_after public.submissions;
  v_payment public.payments;
  v_property uuid;
  v_copy uuid;
  v_created jsonb;
  v_tier text;
  v_event uuid;
begin
  -- B6 invariant 8 (DL-02): a double click, a retry or Create property on screen 4 waits here and then sees the
  -- committed row.
  perform 1 from public.submissions s where s.id = p_submission_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  select * into v_before from public.submissions s where s.id = p_submission_id;
  select * into v_payment from public.payments p
  where p.submission_id = p_submission_id and p.status in ('paid', 'waived');

  -- Idempotent: once the payment has its campaign, a second call returns the same property and writes nothing.
  select c.property_id into v_property from public.campaigns c where c.payment_id = v_payment.id;
  if found then
    return query select v_property, null::uuid, (
      select j.id from public.jobs j where j.idempotency_key = 'copy_submission_media:' || v_property::text
    );
    return;
  end if;
  if v_before.workflow_state <> 'Invoice Issued' or v_payment.id is null then
    raise exception 'wrong_state';
  end if;

  v_property := v_before.property_id;
  if v_property is null then
    -- B7 enqueues the copy_submission_media job in this transaction; the photographs are copied by the runner.
    v_created := public.create_property_from_submission(p_submission_id, p_actor, p_actor_kind, p_request_id);
    v_property := (v_created ->> 'property_id')::uuid;
    v_copy := (v_created ->> 'copy_job_id')::uuid;
  else
    -- Null once B8's prune has removed the finished job.
    select j.id into v_copy from public.jobs j where j.idempotency_key = 'copy_submission_media:' || v_property::text;
  end if;

  update public.submissions s
  set workflow_state = 'Scheduled', property_id = v_property, activated_by = p_actor, activated_at = now()
  where s.id = p_submission_id
  returning * into v_after;
  update public.payments p set property_id = v_property where p.id = v_payment.id;
  -- Dates stay null until B7's publish_property sets them from package_duration_days (invariant 13).
  insert into public.campaigns (property_id, submission_id, payment_id, package, media_budget)
  values (v_property, p_submission_id, v_payment.id, v_payment.product, coalesce(v_before.media_budget, 0));
  v_tier := public.payment_tier(v_payment.product);
  if v_tier is not null then
    update public.properties pr set campaign_tier = v_tier::public.campaign_tier where pr.id = v_property;
  end if;

  perform public.write_audit(
    p_actor, p_actor_kind, 'submissions.activate', 'submissions', p_submission_id, to_jsonb(v_before),
    to_jsonb(v_after), p_request_id
  );
  v_event := public.emit_event(
    'submission.activated', 'submission', p_submission_id,
    jsonb_build_object(
      'submission_id', p_submission_id, 'property_id', v_property, 'tier', v_tier,
      'market', lower(replace(v_before.state::text, ' ', '-'))
    ),
    p_actor
  );
  return query select v_property, v_event, v_copy;
end;
$$;

revoke execute on function public.activate_submission(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.activate_submission(uuid, uuid, public.actor_kind, text) to service_role;
