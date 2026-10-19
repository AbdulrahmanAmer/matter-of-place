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
