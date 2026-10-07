create or replace function public.upsert_campaign_report(p_campaign_id uuid, p_period_start date, p_row jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.campaign_reports := jsonb_populate_record(null::public.campaign_reports, p_row);
  v_id uuid;
begin
  -- One row per campaign and ISO week: a re-run of the week replaces it.
  insert into public.campaign_reports (
    campaign_id, period_start, period_end, media_spend, impressions, reach, clicks, video_views, ctr, geography,
    channel_mix, owned_distribution, top_creative
  ) values (
    p_campaign_id, p_period_start, p_period_start + 6, coalesce(v_row.media_spend, 0), coalesce(v_row.impressions, 0),
    coalesce(v_row.reach, 0), coalesce(v_row.clicks, 0), v_row.video_views, v_row.ctr,
    coalesce(v_row.geography, '{}'), coalesce(v_row.channel_mix, '{}'), coalesce(v_row.owned_distribution, '{}'),
    v_row.top_creative
  )
  on conflict on constraint campaign_reports_week_uq do update
  set period_end = excluded.period_end, media_spend = excluded.media_spend, impressions = excluded.impressions,
    reach = excluded.reach, clicks = excluded.clicks, video_views = excluded.video_views, ctr = excluded.ctr,
    geography = excluded.geography, channel_mix = excluded.channel_mix,
    owned_distribution = excluded.owned_distribution, top_creative = excluded.top_creative
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.upsert_campaign_report(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_campaign_report(uuid, date, jsonb) to service_role;
