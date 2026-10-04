-- down:
--   drop table public.assets;
--   drop type public.asset_status, public.asset_kind;
--   delete from public.settings where key = 'caption_model';
--   The functions and triggers come from the fn migration that follows (bun run db:fn): its down is in its own header.
set lock_timeout = '5s';

-- B9 step 7: the generated creative. `variants` stays in the enum for parity with architecture 3.6, but no step writes
-- an assets row of that kind: variant state lives in property_media.variants.
create type public.asset_kind as enum (
  'variants', 'cover', 'carousel', 'story', 'reel', 'newsletter_block', 'standalone_email'
);
create type public.asset_status as enum ('pending', 'approved', 'rejected', 'published');

-- `files` is [{ media_key, w, h, bytes, role, index? }], `meta` holds captions, slide_alts, spec_hash, caption_lint,
-- max_slides and the newsletter block copy. `job_id` outlives its job (prune deletes done jobs after 30 days).
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  kind public.asset_kind not null,
  revision int not null default 1 check (revision >= 1),
  files jsonb not null default '[]' check (jsonb_typeof(files) = 'array'),
  caption text,
  alt_text text,
  meta jsonb not null default '{}' check (jsonb_typeof(meta) = 'object'),
  status public.asset_status not null default 'pending',
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  rejection_note text,
  job_id uuid references public.jobs (id) on delete set null,
  render_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assets_property_kind_revision_key unique (property_id, kind, revision)
);
create index assets_property_status_idx on public.assets (property_id, status);
create index assets_status_created_idx on public.assets (status, created_at desc);
create index assets_job_idx on public.assets (job_id);
create index assets_approved_by_idx on public.assets (approved_by);
create trigger assets_set_updated_at
before update on public.assets
for each row execute function public.set_updated_at();

-- Architecture 3.7: every staff role reads, media_ops and chief_editor update; no insert and no delete policy. The
-- application writes only through the functions of the fn migration, under the service role (G43).
alter table public.assets enable row level security;
revoke all on table public.assets from anon, authenticated;
grant select, update on table public.assets to authenticated;
grant all on table public.assets to service_role;
create policy assets_select_staff on public.assets for select to authenticated using (app.is_staff());
create policy assets_update_approvers on public.assets for update to authenticated
using (app.role_in('media_ops', 'chief_editor'))
with check (app.role_in('media_ops', 'chief_editor'));

-- The caption runner's model (ruling H34 (3)); a key that no public read carries, so it never bumps catalog_version.
insert into public.settings (key, value)
values ('caption_model', '"claude-haiku-4-5-20251001"'::jsonb)
on conflict (key) do nothing;
