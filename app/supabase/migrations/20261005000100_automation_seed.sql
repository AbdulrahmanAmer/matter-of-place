-- down:
--   delete from public.schedule_settings where key in ('digest', 'audit', 'keepwarm', 'prune', 'reconcile', 'backup',
--     'kpi_weekly', 'newsletter_hygiene');
--   delete from public.channel_settings where channel in ('instagram', 'x', 'linkedin', 'facebook', 'youtube',
--     'newsletter');
--   delete from public.decline_reasons where code in ('not_a_fit', 'outside_markets', 'new_development',
--     'insufficient_material', 'rights_unclear', 'other');
--   delete from public.automation_recipes;
set lock_timeout = '5s';

-- B8b step 4: the configuration the automation console starts from. Every insert skips a row that exists, so the file
-- is safe to run again and in production (configuration, not content). The settings.flags row is B3b's.

-- Invariant 8: one recipe per event type of architecture 3.6 (G29). A step id equals its step type unless a recipe
-- uses the type twice or the id says which email it sends.
insert into public.automation_recipes (trigger, name, enabled, steps) values
  ('submission.received', 'Submission received', true, '[
    {"id": "send_received", "step_type": "send_email", "params": {"template": "received"}, "enabled": true, "requires_approval": false, "conditions": {}},
    {"id": "notify_admin_received", "step_type": "notify_admin", "params": {}, "enabled": true, "requires_approval": false, "conditions": {}}
  ]'),
  ('submission.declined', 'Submission declined', true, '[
    {"id": "send_declined", "step_type": "send_email", "params": {"template": "declined"}, "enabled": true, "requires_approval": false, "conditions": {}}
  ]'),
  ('submission.accepted', 'Submission accepted', true, '[
    {"id": "send_accepted", "step_type": "send_email", "params": {"template": "accepted"}, "enabled": true, "requires_approval": false, "conditions": {}}
  ]'),
  ('submission.awaiting_assets', 'Awaiting material', true, '[
    {"id": "send_awaiting_assets", "step_type": "send_email", "params": {"template": "awaiting_assets"}, "enabled": true, "requires_approval": false, "conditions": {}}
  ]'),
  ('invoice.issued', 'Invoice issued', true, '[
    {"id": "send_invoice", "step_type": "send_email", "params": {"template": "invoice", "attach": "invoice_pdf"}, "enabled": true, "requires_approval": false, "conditions": {}}
  ]'),
  ('payment.marked', 'Payment recorded', true, '[
    {"id": "notify_admin_payment", "step_type": "notify_admin", "params": {}, "enabled": true, "requires_approval": false, "conditions": {}}
  ]'),
  ('submission.activated', 'Submission activated', true, '[]'),
  ('property.published', 'Property published', true, '[
    {"id": "bump_catalog_version", "step_type": "bump_catalog_version", "params": {}, "enabled": true, "requires_approval": false, "conditions": {}},
    {"id": "purge_cache", "step_type": "purge_cache", "params": {}, "enabled": true, "requires_approval": false, "conditions": {}},
    {"id": "render_variants", "step_type": "render_variants", "params": {}, "enabled": true, "requires_approval": false, "conditions": {}},
    {"id": "render_cover", "step_type": "render_cover", "params": {}, "enabled": true, "requires_approval": false, "conditions": {}},
    {"id": "render_carousel", "step_type": "render_carousel", "params": {}, "enabled": true, "requires_approval": false, "conditions": {}},
    {"id": "render_story", "step_type": "render_story", "params": {}, "enabled": true, "requires_approval": false, "conditions": {}},
    {"id": "write_captions", "step_type": "write_captions", "params": {}, "enabled": true, "requires_approval": false, "conditions": {}},
    {"id": "build_newsletter_block", "step_type": "build_newsletter_block", "params": {}, "enabled": true, "requires_approval": false, "conditions": {}},
    {"id": "render_reel", "step_type": "render_reel", "params": {}, "enabled": true, "requires_approval": false, "conditions": {"tiers": ["Campaign"]}},
    {"id": "send_standalone", "step_type": "send_email", "params": {"template": "standalone"}, "enabled": true, "requires_approval": true, "conditions": {"tiers": ["Campaign"]}}
  ]'),
  ('property.unpublished', 'Property unpublished', true, '[
    {"id": "bump_catalog_version", "step_type": "bump_catalog_version", "params": {}, "enabled": true, "requires_approval": false, "conditions": {}},
    {"id": "purge_cache", "step_type": "purge_cache", "params": {}, "enabled": true, "requires_approval": false, "conditions": {}}
  ]'),
  ('asset.approved', 'Asset approved', true, '[
    {"id": "post_meta", "step_type": "post_meta", "params": {"channels": "from_settings"}, "enabled": true, "requires_approval": false, "conditions": {"kinds": ["cover", "carousel", "story", "reel"]}},
    {"id": "post_x", "step_type": "post_x", "params": {}, "enabled": true, "requires_approval": false, "conditions": {"kinds": ["cover", "carousel", "story", "reel"]}},
    {"id": "post_linkedin", "step_type": "post_linkedin", "params": {}, "enabled": true, "requires_approval": false, "conditions": {"kinds": ["cover", "carousel", "story", "reel"]}},
    {"id": "queue_digest", "step_type": "queue_digest", "params": {"mode": "add"}, "enabled": true, "requires_approval": false, "conditions": {"kinds": ["newsletter_block"]}}
  ]'),
  ('asset.rejected', 'Asset rejected', true, '[]'),
  ('digest.due', 'Place Notes due', true, '[
    {"id": "queue_digest", "step_type": "queue_digest", "params": {"mode": "assemble"}, "enabled": true, "requires_approval": false, "conditions": {}},
    {"id": "notify_admin_digest", "step_type": "notify_admin", "params": {}, "enabled": true, "requires_approval": false, "conditions": {}}
  ]'),
  ('inquiry.received', 'Inquiry received', true, '[
    {"id": "send_inquiry_ack", "step_type": "send_email", "params": {"template": "inquiry_ack"}, "enabled": true, "requires_approval": false, "conditions": {}},
    {"id": "send_inquiry_forward", "step_type": "send_email", "params": {"template": "inquiry_forward", "to": "submitter"}, "enabled": true, "requires_approval": false, "conditions": {}},
    {"id": "notify_admin_inquiry", "step_type": "notify_admin", "params": {}, "enabled": true, "requires_approval": false, "conditions": {}},
    {"id": "webhook_omnikom", "step_type": "webhook_omnikom", "params": {}, "enabled": true, "requires_approval": false, "conditions": {}}
  ]'),
  ('subscriber.created', 'Signup to confirm', true, '[
    {"id": "send_confirm", "step_type": "send_email", "params": {"template": "interest_confirm"}, "enabled": true, "requires_approval": false, "conditions": {}}
  ]'),
  ('subscriber.confirmed', 'Signup confirmed', true, '[]'),
  ('invoice.voided', 'Invoice voided', true, '[
    {"id": "notify_admin_void", "step_type": "notify_admin", "params": {}, "enabled": true, "requires_approval": false, "conditions": {}}
  ]'),
  ('health.failed', 'Health check failed', true, '[
    {"id": "notify_admin_health", "step_type": "notify_admin", "params": {"template": "admin_notify", "headline": "Health check failed"}, "enabled": true, "requires_approval": false, "conditions": {}}
  ]'),
  ('subject_request.received', 'Privacy request received', true, '[
    {"id": "send_subject_ack", "step_type": "send_email", "params": {"template": "subject_ack", "to": "requester"}, "enabled": true, "requires_approval": false, "conditions": {}},
    {"id": "notify_admin_subject", "step_type": "notify_admin", "params": {"headline": "Privacy request received"}, "enabled": true, "requires_approval": false, "conditions": {}}
  ]')
on conflict (trigger) do nothing;

-- The CEO reviews this copy before launch. `other` has no paragraph: the admin's note is the message.
insert into public.decline_reasons (code, label, email_paragraph, sort) values
  ('not_a_fit', 'Not the right fit for the editorial standard',
    'We read every submission against our editorial standard, and this home is not the right fit for it. Thank you for letting us see it.',
    1),
  ('outside_markets', 'Outside California, New York and Florida',
    'We publish homes in California, New York and Florida only. This home sits outside those markets, so we cannot feature it.',
    2),
  ('new_development', 'New development',
    'We feature existing homes and do not publish new developments. This property falls outside that focus.',
    3),
  ('insufficient_material', 'Not enough material to review',
    'We could not review the home with the material we received. You are welcome to submit again with more photographs and a fuller description.',
    4),
  ('rights_unclear', 'Photography rights not confirmed',
    'We publish only photographs whose rights are confirmed. Please submit again once the photographer''s permission is in place.',
    5),
  ('other', 'Other, see note', '', 6)
on conflict (code) do nothing;

-- S48: the newsletter is on; Instagram, X and LinkedIn stay off until their credentials check passes (B10, L1);
-- Facebook and YouTube are blocks switched on later. Approval is manual for every tier at launch (S23). The
-- credentials_ref is the NAME of a secret, never a value.
insert into public.channel_settings (channel, enabled, posting_window, approval_mode, auto_after, credentials_ref)
select channel, enabled,
  '{"days": [1, 2, 3, 4, 5], "from": "09:00", "to": "18:00", "tz": "America/New_York", "daily_cap": 2}'::jsonb,
  '{"Feature": "manual", "Reach": "manual", "Campaign": "manual"}'::jsonb,
  null, credentials_ref
from (values
  ('newsletter', true, null::text),
  ('instagram', false, 'meta'),
  ('x', false, 'x'),
  ('linkedin', false, 'linkedin'),
  ('facebook', false, 'meta'),
  ('youtube', false, null)
) as seed (channel, enabled, credentials_ref)
on conflict (channel) do nothing;

-- Invariants 11 and 12, all cron in UTC. keepwarm equals the wrangler.toml trigger and backup the schedule line of
-- backup.yml; digest, audit and backup start off until their first run is ready (B11, B14, B1b).
insert into public.schedule_settings (key, cron, interval_days, enabled) values
  ('digest', '0 14 * * 2', 14, false),
  ('audit', '0 12 * * 6', null, false),
  ('keepwarm', '*/10 * * * *', null, true),
  ('prune', '30 3 * * *', null, true),
  ('reconcile', '*/15 * * * *', null, true),
  ('backup', '17 3 * * *', null, false),
  ('kpi_weekly', '0 15 * * 6', null, true),
  ('newsletter_hygiene', '0 16 * * *', null, true)
on conflict (key) do nothing;
