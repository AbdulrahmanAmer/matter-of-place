-- down:
--   drop policy <table>_<operation>_<who> on public.<table>;  -- every policy created below
--   revoke all on all tables in schema public from authenticated;
--   alter default privileges for role postgres in schema public revoke all on tables from service_role;
--   alter default privileges for role postgres in schema public revoke all on sequences from service_role;
--   alter default privileges for role postgres in schema public revoke execute on functions from service_role;
--   alter default privileges for role postgres grant execute on functions to public;
set lock_timeout = '5s';

-- Architecture 3.7, mirrored row by row in tests/db/rls-matrix.ts. Everything fails closed first, then each grant is
-- explicit, so the result is the same after db:reset and on a fresh stack (G-100).
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- A per-schema rule cannot remove the built-in execute grant to public, so that one is global.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant all on sequences to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

-- The policies call these as the signed-in user (the authenticatedFunctions allow-list).
grant execute on function public.role_in(variadic public.app_role[]), public.is_staff() to authenticated;

alter table public.migration_checksums enable row level security;
alter table public.user_roles enable row level security;
alter table public.agent_keys enable row level security;
alter table public.audit_log enable row level security;
alter table public.pii_columns enable row level security;
alter table public.markets enable row level security;
alter table public.regions enable row level security;
alter table public.market_notes enable row level security;
alter table public.market_guide_entries enable row level security;
alter table public.representatives enable row level security;
alter table public.properties enable row level security;
alter table public.property_media enable row level security;
alter table public.property_features enable row level security;
alter table public.property_related enable row level security;
alter table public.stories enable row level security;
alter table public.settings enable row level security;
alter table public.slug_history enable row level security;
alter table public.redirects enable row level security;
alter table public.retention_policies enable row level security;
alter table public.contacts enable row level security;
alter table public.decline_reasons enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_media enable row level security;
alter table public.inquiries enable row level security;
alter table public.subscribers enable row level security;
alter table public.analytics_events enable row level security;
alter table public.analytics_events_default enable row level security;
alter table public.payments enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_reports enable row level security;

-- Select for every staff role. migration_checksums and pii_columns get no grant and no policy: only the service role
-- and postgres reach them. The monthly analytics partitions are read through their parent.
grant select on public.user_roles, public.agent_keys, public.audit_log, public.markets, public.regions,
  public.market_notes, public.market_guide_entries, public.representatives, public.properties,
  public.property_media, public.property_features, public.property_related, public.stories, public.settings,
  public.slug_history, public.redirects, public.retention_policies, public.contacts, public.decline_reasons,
  public.submissions, public.submission_media, public.inquiries, public.subscribers, public.analytics_events,
  public.payments, public.campaigns, public.campaign_reports
to authenticated;

create policy user_roles_select_staff on public.user_roles for select to authenticated using (public.is_staff());
create policy agent_keys_select_staff on public.agent_keys for select to authenticated using (public.is_staff());
create policy audit_log_select_staff on public.audit_log for select to authenticated using (public.is_staff());
create policy markets_select_staff on public.markets for select to authenticated using (public.is_staff());
create policy regions_select_staff on public.regions for select to authenticated using (public.is_staff());
create policy market_notes_select_staff on public.market_notes for select to authenticated
using (public.is_staff());
create policy market_guide_entries_select_staff on public.market_guide_entries for select to authenticated
using (public.is_staff());
create policy representatives_select_staff on public.representatives for select to authenticated
using (public.is_staff());
create policy properties_select_staff on public.properties for select to authenticated using (public.is_staff());
create policy property_media_select_staff on public.property_media for select to authenticated
using (public.is_staff());
create policy property_features_select_staff on public.property_features for select to authenticated
using (public.is_staff());
create policy property_related_select_staff on public.property_related for select to authenticated
using (public.is_staff());
create policy stories_select_staff on public.stories for select to authenticated using (public.is_staff());
create policy settings_select_staff on public.settings for select to authenticated using (public.is_staff());
create policy slug_history_select_staff on public.slug_history for select to authenticated
using (public.is_staff());
create policy redirects_select_staff on public.redirects for select to authenticated using (public.is_staff());
create policy retention_policies_select_staff on public.retention_policies for select to authenticated
using (public.is_staff());
create policy contacts_select_staff on public.contacts for select to authenticated using (public.is_staff());
create policy decline_reasons_select_staff on public.decline_reasons for select to authenticated
using (public.is_staff());
create policy submissions_select_staff on public.submissions for select to authenticated using (public.is_staff());
create policy submission_media_select_staff on public.submission_media for select to authenticated
using (public.is_staff());
create policy inquiries_select_staff on public.inquiries for select to authenticated using (public.is_staff());
create policy subscribers_select_staff on public.subscribers for select to authenticated using (public.is_staff());
create policy analytics_events_select_staff on public.analytics_events for select to authenticated
using (public.is_staff());
create policy payments_select_staff on public.payments for select to authenticated using (public.is_staff());
create policy campaigns_select_staff on public.campaigns for select to authenticated using (public.is_staff());
create policy campaign_reports_select_staff on public.campaign_reports for select to authenticated
using (public.is_staff());

-- Team: admin. Only agent_keys has a delete anywhere.
grant insert, update on public.user_roles to authenticated;
create policy user_roles_insert_admin on public.user_roles for insert to authenticated
with check (public.role_in('admin'));
create policy user_roles_update_admin on public.user_roles for update to authenticated
using (public.role_in('admin'));

grant insert, update, delete on public.agent_keys to authenticated;
create policy agent_keys_insert_admin on public.agent_keys for insert to authenticated
with check (public.role_in('admin'));
create policy agent_keys_update_admin on public.agent_keys for update to authenticated
using (public.role_in('admin'));
create policy agent_keys_delete_admin on public.agent_keys for delete to authenticated
using (public.role_in('admin'));

-- Properties write: chief_editor, managing_editor, visual_editor.
grant insert, update on public.properties to authenticated;
create policy properties_insert_editors on public.properties for insert to authenticated
with check (public.role_in('chief_editor', 'managing_editor', 'visual_editor'));
create policy properties_update_editors on public.properties for update to authenticated
using (public.role_in('chief_editor', 'managing_editor', 'visual_editor'));

-- Redirects and decline reasons (G17): chief_editor, managing_editor, admin.
grant insert, update on public.redirects to authenticated;
create policy redirects_insert_editors on public.redirects for insert to authenticated
with check (public.role_in('chief_editor', 'managing_editor', 'admin'));
create policy redirects_update_editors on public.redirects for update to authenticated
using (public.role_in('chief_editor', 'managing_editor', 'admin'));

grant insert, update on public.decline_reasons to authenticated;
create policy decline_reasons_insert_editors on public.decline_reasons for insert to authenticated
with check (public.role_in('chief_editor', 'managing_editor', 'admin'));
create policy decline_reasons_update_editors on public.decline_reasons for update to authenticated
using (public.role_in('chief_editor', 'managing_editor', 'admin'));

grant update on public.retention_policies to authenticated;
create policy retention_policies_update_admin on public.retention_policies for update to authenticated
using (public.role_in('admin'));

-- Submissions decide: chief_editor, managing_editor. The Worker's service role inserts every request.
grant update on public.submissions to authenticated;
create policy submissions_update_deciders on public.submissions for update to authenticated
using (public.role_in('chief_editor', 'managing_editor'));

-- ASSUMED (B2 Data changes 10): inquiries update by chief_editor, managing_editor, admin; subscribers by admin.
grant update on public.inquiries to authenticated;
create policy inquiries_update_editors on public.inquiries for update to authenticated
using (public.role_in('chief_editor', 'managing_editor', 'admin'));

grant update on public.subscribers to authenticated;
create policy subscribers_update_admin on public.subscribers for update to authenticated
using (public.role_in('admin'));

-- Payments: managing_editor, admin.
grant insert, update on public.payments to authenticated;
create policy payments_insert_finance on public.payments for insert to authenticated
with check (public.role_in('managing_editor', 'admin'));
create policy payments_update_finance on public.payments for update to authenticated
using (public.role_in('managing_editor', 'admin'));
