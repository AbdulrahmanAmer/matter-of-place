create or replace function public.email_campaign_report(
  p_report_id uuid,
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
  v_submission uuid;
  v_job uuid;
begin
  -- G22: the report goes to the person who submitted the property. A double click in one minute makes one job.
  select c.submission_id into v_submission
  from public.campaign_reports r
  join public.campaigns c on c.id = r.campaign_id
  where r.id = p_report_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_submission is null then
    raise exception 'recipient_missing' using errcode = '22023';
  end if;
  v_job := public.enqueue_job(
    'send_email',
    jsonb_build_object(
      'params', jsonb_build_object('template', 'campaign_report', 'to', 'submitter'),
      'data', jsonb_build_object('submission_id', v_submission, 'report_id', p_report_id)
    ),
    format('send_email:report:%s:%s', p_report_id, floor(extract(epoch from now()) / 60)::bigint),
    p_max_attempts => 12
  );
  if v_job is not null then
    perform public.write_audit(
      p_actor, p_actor_kind, 'reports.email', 'campaign_reports', p_report_id, null,
      jsonb_build_object('job_id', v_job), p_request_id
    );
  end if;
  return v_job;
end;
$$;

revoke execute on function public.email_campaign_report(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.email_campaign_report(uuid, uuid, public.actor_kind, text) to service_role;
