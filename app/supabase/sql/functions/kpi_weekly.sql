create or replace function public.kpi_weekly(p_week_start date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  -- B11 invariant 12 (GG-03): the numbers of one ISO week, Monday to Sunday in the owner's zone (ASSUMED
  -- America/New_York), for the CEO's Saturday email and B14's audit report. The words for each number are in
  -- src/server/kpi/definitions.ts; this function is the only place they are counted.
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'validation' using errcode = '22023';
  end if;
  v_start := p_week_start::timestamp at time zone 'America/New_York';
  v_end := (p_week_start + 7)::timestamp at time zone 'America/New_York';

  return (
    with decisions as (
      select e.type, e.at, e.payload ->> 'submission_id' as submission_id
      from public.events e
      where e.type in ('submission.accepted', 'submission.declined')
    ),
    first_decisions as (
      select d.submission_id, min(d.at) as decided_at
      from decisions d
      group by d.submission_id
    ),
    week_inquiries as (
      select i.subject_kind, i.subject_slug
      from public.inquiries i
      where i.received_at >= v_start and i.received_at < v_end
    ),
    top_properties as (
      select p.slug, p.title, count(*)::int as n
      from week_inquiries i
      join public.properties p on p.slug = i.subject_slug
      where i.subject_kind = 'property'
      group by p.slug, p.title
      order by n desc, p.slug
      limit 5
    )
    select jsonb_build_object(
      'week_start', p_week_start,
      'week_end', p_week_start + 6,
      'submissions_received', (
        select count(*)::int from public.submissions s
        where s.received_at >= v_start and s.received_at < v_end
      ),
      'decisions', (
        select jsonb_build_object(
          'accepted', count(*) filter (where d.type = 'submission.accepted')::int,
          'declined', count(*) filter (where d.type = 'submission.declined')::int
        )
        from decisions d
        where d.at >= v_start and d.at < v_end
      ),
      'time_to_decision_hours', (
        select round(
          (percentile_cont(0.5) within group (
            order by extract(epoch from f.decided_at - s.received_at) / 3600
          ))::numeric,
          1
        )
        from first_decisions f
        join public.submissions s on s.id::text = f.submission_id
        where f.decided_at >= v_start and f.decided_at < v_end
      ),
      'invoices', (
        select jsonb_build_object(
          'issued', count(*) filter (where pay.issued_at >= v_start and pay.issued_at < v_end)::int,
          'issued_amount', coalesce(sum(pay.amount) filter (where pay.issued_at >= v_start and pay.issued_at < v_end), 0),
          'paid', count(*) filter (where pay.paid_at >= v_start and pay.paid_at < v_end)::int,
          'paid_amount', coalesce(sum(pay.amount) filter (where pay.paid_at >= v_start and pay.paid_at < v_end), 0)
        )
        from public.payments pay
        where pay.status <> 'void'
      ),
      'properties_published', (
        select count(*)::int from public.properties p
        where p.published_at >= v_start and p.published_at < v_end
      ),
      'posts_by_channel', (
        select coalesce(jsonb_object_agg(c.channel, c.n), '{}'::jsonb)
        from (
          select sp.channel, count(*)::int as n
          from public.social_posts sp
          where sp.posted_at >= v_start and sp.posted_at < v_end
          group by sp.channel
        ) c
      ),
      'newsletter', (
        select jsonb_build_object(
          'confirmed', w.confirmed,
          'unsubscribed', w.unsubscribed,
          'net', w.confirmed - w.unsubscribed,
          'total_confirmed', w.total_confirmed
        )
        from (
          select
            count(*) filter (where sub.confirmed_at >= v_start and sub.confirmed_at < v_end)::int as confirmed,
            count(*) filter (where sub.unsubscribed_at >= v_start and sub.unsubscribed_at < v_end)::int
              as unsubscribed,
            count(*) filter (
              where sub.confirmed_at < v_end and (sub.unsubscribed_at is null or sub.unsubscribed_at >= v_end)
            )::int as total_confirmed
          from public.subscribers sub
        ) w
      ),
      'inquiries', jsonb_build_object(
        'received', (select count(*)::int from week_inquiries),
        'published_properties', (
          select count(*)::int from public.properties p
          where p.editorial_state = 'published' and p.published_at < v_end
        ),
        'top', (
          select coalesce(
            jsonb_agg(jsonb_build_object('slug', t.slug, 'title', t.title, 'count', t.n) order by t.n desc, t.slug),
            '[]'::jsonb
          )
          from top_properties t
        )
      )
    )
  );
end;
$$;

revoke execute on function public.kpi_weekly(date) from public, anon, authenticated;
grant execute on function public.kpi_weekly(date) to service_role;
