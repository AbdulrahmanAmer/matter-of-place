-- down: delete from public.email_templates where key = 'campaign_report';
set lock_timeout = '5s';

-- B10 step 9 (G22, G46): the weekly campaign report email, in B5's row shape. The same copy as
-- src/templates/email/campaign-report.tsx; an edited row survives a replay.
insert into public.email_templates (key, class, subject, preheader, body, variables, enabled)
values (
  'campaign_report', 'transactional', '{{property_name}}: the week of {{period}}',
  'Reach, views and visits from Matter of Place',
  '[
    {"type": "heading", "text": "{{property_name}}"},
    {"type": "paragraph", "text": "The week of {{period}}."},
    {"type": "facts", "rows": [
      {"label": "Impressions", "value": "{{impressions}}"},
      {"label": "Reach", "value": "{{reach}}"},
      {"label": "Visits from social links", "value": "{{clicks}}"},
      {"label": "Video views", "value": "{{video_views}}"},
      {"label": "Click-through rate", "value": "{{ctr}}"}
    ]},
    {"type": "paragraph", "text": "Visits are counted on matterofplace.com from the links we posted. The platforms report the other figures."},
    {"type": "signature"}
  ]',
  '{property_name,period,impressions,reach,clicks,video_views,ctr}', true
)
on conflict (key) do nothing;
