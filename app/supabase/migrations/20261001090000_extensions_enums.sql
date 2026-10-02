-- down:
--   drop table public.migration_checksums;
--   drop function public.set_updated_at();
--   drop type public.property_type, public.listing_status, public.campaign_tier, public.submission_source,
--     public.editorial_state, public.media_orientation, public.story_category, public.inquiry_intent,
--     public.inquiry_state, public.accepted_state, public.exposure_package, public.submission_state,
--     public.channel_status, public.app_role, public.actor_kind, public.payment_status, public.payment_method,
--     public.submitter_kind;
--   pg_cron stays: the jobs of later migrations live in it.
set lock_timeout = '5s';

-- `if not exists`: db:reset empties `public` and keeps extensions (F16). pgmq and pg_net arrive with B8.
create extension if not exists pg_cron with schema pg_catalog;

create type public.property_type as enum (
  'Estate', 'Residence', 'Townhouse', 'Waterfront', 'Farmhouse', 'Apartment', 'Penthouse'
);
create type public.listing_status as enum ('Illustrative', 'Active', 'Off-market', 'Under offer', 'Sold');
create type public.campaign_tier as enum ('Editorial', 'Feature', 'Reach', 'Campaign');
create type public.submission_source as enum ('Editorial', 'Submission');
-- GG-07: `agent_review` is the optional state in which the listing agent approves the narrative.
create type public.editorial_state as enum ('draft', 'review', 'agent_review', 'published', 'archived');
create type public.media_orientation as enum ('landscape', 'portrait');
create type public.story_category as enum ('Architecture', 'Interiors', 'Places', 'Stories');
create type public.inquiry_intent as enum ('showing', 'ask', 'similar', 'sell', 'invest', 'agent', 'general');
create type public.inquiry_state as enum ('new', 'in_progress', 'forwarded', 'closed');
create type public.accepted_state as enum ('California', 'New York', 'Florida');
create type public.exposure_package as enum (
  'The Feature', 'The Reach', 'The Campaign', 'Five Features', 'Not sure yet'
);
-- S32: `Invoice Issued` replaces the sketch's `Awaiting Payment`; DL-04: `Withdrawn` is terminal.
create type public.submission_state as enum (
  'Submitted', 'Under Review', 'Accepted', 'Declined', 'Awaiting Assets', 'Invoice Issued', 'Scheduled',
  'Published', 'Distribution Active', 'Completed', 'Withdrawn'
);
create type public.channel_status as enum ('none', 'planned', 'active', 'done');
create type public.app_role as enum (
  'chief_editor', 'managing_editor', 'visual_editor', 'media_ops', 'commercial', 'admin'
);
create type public.actor_kind as enum ('human', 'agent');
-- B6 adds `void` in its own migration.
create type public.payment_status as enum ('due', 'paid', 'waived', 'refunded');
create type public.payment_method as enum ('invoice_manual', 'stripe');
-- S55: a request comes from a real estate agent or from the owner.
create type public.submitter_kind as enum ('agent', 'owner');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- E2E-06: written only by scripts/db-push.mjs, as postgres.
create table public.migration_checksums (
  version text primary key,
  sha256 text not null,
  pushed_at timestamptz not null default now()
);
alter table public.migration_checksums enable row level security;
-- db:reset drops the schema's default privileges and a fresh stack still has them, so every grant is explicit
-- (invariant 1).
revoke all on table public.migration_checksums from anon, authenticated;
grant all on table public.migration_checksums to service_role;

-- S49: Supabase's automatic-RLS helper is security definer and callable through the API (advisor lints 0028 and
-- 0029). db:reset drops it with the schema, so the revoke runs only while it exists.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from anon, authenticated, public;
  end if;
end
$$;
