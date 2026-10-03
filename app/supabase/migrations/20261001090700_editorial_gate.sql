-- down:
--   drop trigger refuse_hard_delete on public.properties; drop trigger refuse_hard_delete on public.stories;
--   drop trigger refuse_hard_delete on public.subscribers; drop trigger refuse_hard_delete on public.submissions;
--   drop trigger refuse_hard_delete on public.contacts; drop trigger refuse_hard_delete on public.inquiries;
--   drop trigger refuse_hard_delete on public.payments; drop trigger refuse_hard_delete on public.campaigns;
--   drop trigger enforce_editorial_state_order on public.properties;
--   drop trigger enforce_publish_gate on public.properties; drop trigger enforce_publish_gate on public.stories;
--   drop trigger enforce_slug_immutable on public.properties; drop trigger properties_version_bump on public.properties;
--   drop trigger enforce_editorial_gate on public.submissions;
--   drop function public.refuse_hard_delete(), public.enforce_editorial_state_order(),
--     public.editorial_transition_allowed(public.editorial_state, public.editorial_state),
--     public.enforce_slug_immutable(), public.save_property(uuid, int, jsonb), public.properties_version_bump(),
--     public.enforce_publish_gate(), public.enforce_editorial_gate(),
--     public.submission_transition_allowed(public.submission_state, public.submission_state);
set lock_timeout = '5s';

-- Invariant 5: the submission graph, mirrored by submissionTransitions of src/domain/workflow.ts.
create or replace function public.submission_transition_allowed(
  p_from public.submission_state,
  p_to public.submission_state
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select (p_from::text, p_to::text) in (
    ('Submitted', 'Under Review'),
    ('Under Review', 'Declined'),
    ('Under Review', 'Awaiting Assets'),
    ('Under Review', 'Accepted'),
    ('Awaiting Assets', 'Under Review'),
    ('Awaiting Assets', 'Accepted'),
    ('Awaiting Assets', 'Withdrawn'),
    ('Accepted', 'Awaiting Assets'),
    ('Accepted', 'Invoice Issued'),
    ('Accepted', 'Withdrawn'),
    ('Invoice Issued', 'Invoice Issued'),
    ('Invoice Issued', 'Scheduled'),
    ('Invoice Issued', 'Withdrawn'),
    ('Scheduled', 'Published'),
    ('Published', 'Distribution Active'),
    ('Published', 'Completed'),
    ('Distribution Active', 'Completed')
  );
$$;

create or replace function public.enforce_editorial_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Invariant 5: an update that keeps the state (a note, a reviewer) skips the graph.
  if new.workflow_state = old.workflow_state then
    return new;
  end if;
  if not public.submission_transition_allowed(old.workflow_state, new.workflow_state) then
    raise exception 'wrong_state';
  end if;
  if new.workflow_state = 'Accepted' then
    new.accepted_at := coalesce(new.accepted_at, now());
  end if;
  if new.workflow_state in ('Invoice Issued', 'Scheduled', 'Published', 'Distribution Active', 'Completed')
    and new.accepted_at is null then
    raise exception 'wrong_state';
  end if;
  if new.workflow_state = 'Scheduled' and not exists (
    select 1 from public.payments p where p.submission_id = new.id and p.status in ('paid', 'waived')
  ) then
    raise exception 'wrong_state';
  end if;
  -- DL-04: a paid or waived request is refunded or voided before it can be withdrawn.
  if new.workflow_state = 'Withdrawn' and exists (
    select 1 from public.payments p where p.submission_id = new.id and p.status in ('paid', 'waived')
  ) then
    raise exception 'wrong_state';
  end if;
  return new;
end;
$$;

create trigger enforce_editorial_gate
before update on public.submissions
for each row execute function public.enforce_editorial_gate();

-- Invariant 21 (DL-03): the property editorial graph, mirrored by propertyEditorialTransitions.
create or replace function public.editorial_transition_allowed(
  p_from public.editorial_state,
  p_to public.editorial_state
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select (p_from::text, p_to::text) in (
    ('draft', 'review'),
    ('draft', 'agent_review'),
    ('draft', 'archived'),
    ('review', 'draft'),
    ('review', 'agent_review'),
    ('review', 'published'),
    ('review', 'archived'),
    ('agent_review', 'review'),
    ('agent_review', 'draft'),
    ('agent_review', 'published'),
    ('agent_review', 'archived'),
    ('published', 'archived'),
    ('archived', 'draft')
  );
$$;

create or replace function public.enforce_editorial_state_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.editorial_state <> old.editorial_state
    and not public.editorial_transition_allowed(old.editorial_state, new.editorial_state) then
    raise exception 'wrong_state';
  end if;
  return new;
end;
$$;

-- Before update triggers run in name order: the graph first, then the publish gate, the slug, updated_at, and the
-- version last (DB-16).
create trigger enforce_editorial_state_order
before update on public.properties
for each row execute function public.enforce_editorial_state_order();

create or replace function public.enforce_publish_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.editorial_state <> 'published' then
    return new;
  end if;
  -- Not security definer, so current_user is the caller; the server functions check roles before they call.
  if (tg_op = 'INSERT' or old.editorial_state <> 'published')
    and not (
      current_user in ('service_role', 'postgres')
      or public.role_in('chief_editor', 'managing_editor', 'admin')
    ) then
    raise exception 'publish_not_allowed';
  end if;
  -- A published property fills every field of the public Property type, whoever writes it.
  if tg_table_name = 'properties' and (
    new.region_slug is null or new.neighborhood is null or new.country is null or new.price is null
    or new.beds is null or new.baths is null or new.interior_sq_ft is null or new.lot_acres is null
    or new.year_built is null or new.style is null or new.hero_image is null or new.place is null
  ) then
    raise exception 'publish_incomplete' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger enforce_publish_gate
before insert or update on public.properties
for each row execute function public.enforce_publish_gate();
create trigger enforce_publish_gate
before insert or update on public.stories
for each row execute function public.enforce_publish_gate();

create or replace function public.enforce_slug_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Invariant 11: the first publication is recorded once and never cleared or moved.
  if tg_op = 'INSERT' then
    new.first_published_at := new.published_at;
  else
    new.first_published_at := coalesce(old.first_published_at, new.published_at);
    if new.slug = old.slug then
      return new;
    end if;
    if old.first_published_at is not null then
      raise exception 'slug_immutable';
    end if;
  end if;
  if exists (select 1 from public.slug_history h where h.slug = new.slug and h.property_id <> new.id) then
    raise exception 'slug_taken';
  end if;
  if tg_op = 'UPDATE' then
    -- GD-02: the old slug of a draft answers with a 301; a draft that takes back its own old slug leaves history.
    delete from public.slug_history where slug = new.slug;
    insert into public.slug_history (slug, property_id) values (old.slug, old.id);
  end if;
  return new;
end;
$$;

create trigger enforce_slug_immutable
before insert or update on public.properties
for each row execute function public.enforce_slug_immutable();

-- Invariant 10 (GD-01).
create or replace function public.properties_version_bump()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- DB-16: the system columns, the two this trigger and set_updated_at write, and the generated search_text, which
  -- a BEFORE trigger sees before it is computed.
  v_ignored constant text[] := array['hero_image', 'video', 'og_image_key', 'updated_at', 'version', 'search_text'];
begin
  if (to_jsonb(new) - v_ignored) = (to_jsonb(old) - v_ignored) and new.version = old.version then
    return new;
  end if;
  new.version := old.version + 1;
  return new;
end;
$$;

create trigger properties_version_bump
before update on public.properties
for each row execute function public.properties_version_bump();

-- The one edit path of the Worker's server functions (invariant 10). B7 checks the version of a write outside the
-- allow-list by calling it with `{}` first, under the row lock it takes.
create or replace function public.save_property(p_id uuid, p_expected_version int, p_patch jsonb)
returns public.properties
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- savePropertyAllowedKeys of tests/db/schema-manifest.ts. System, state and publication columns have their own
  -- writers (G6, G23, G66).
  v_allowed constant text[] := array[
    'slug', 'title', 'market_slug', 'region_slug', 'city', 'neighborhood', 'state', 'country', 'address',
    'coordinates', 'price', 'currency', 'beds', 'baths', 'interior_sq_ft', 'lot_acres', 'year_built', 'type',
    'style', 'architect', 'designer', 'status', 'story', 'place', 'representative_id', 'presented_by_owner',
    'listing_url', 'hero_rank', 'featured_rank', 'updated_by'
  ];
  v_old public.properties;
  v_new public.properties;
begin
  select * into v_old from public.properties where id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_old.version <> p_expected_version then
    raise exception 'version_conflict' using errcode = '40001';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k <> all (v_allowed)) then
    raise exception 'invalid_patch_key' using errcode = '22023';
  end if;
  v_new := jsonb_populate_record(v_old, p_patch);
  -- One update, so every trigger runs; an empty patch only raises the version.
  update public.properties
  set slug = v_new.slug,
    title = v_new.title,
    market_slug = v_new.market_slug,
    region_slug = v_new.region_slug,
    city = v_new.city,
    neighborhood = v_new.neighborhood,
    state = v_new.state,
    country = v_new.country,
    address = v_new.address,
    coordinates = v_new.coordinates,
    price = v_new.price,
    currency = v_new.currency,
    beds = v_new.beds,
    baths = v_new.baths,
    interior_sq_ft = v_new.interior_sq_ft,
    lot_acres = v_new.lot_acres,
    year_built = v_new.year_built,
    type = v_new.type,
    style = v_new.style,
    architect = v_new.architect,
    designer = v_new.designer,
    status = v_new.status,
    story = v_new.story,
    place = v_new.place,
    representative_id = v_new.representative_id,
    presented_by_owner = v_new.presented_by_owner,
    listing_url = v_new.listing_url,
    hero_rank = v_new.hero_rank,
    featured_rank = v_new.featured_rank,
    updated_by = v_new.updated_by,
    version = v_old.version + 1
  where id = p_id
  returning * into v_new;
  return v_new;
end;
$$;

-- Invariant 4 (GD-04): it binds the service role too, which RLS does not.
create or replace function public.refuse_hard_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- GD-04: only B8's retention job (and test helpers) sets mop.retention, for its own transaction.
  if current_setting('mop.retention', true) = 'on' then
    return old;
  end if;
  raise exception 'hard_delete_refused';
end;
$$;

create trigger refuse_hard_delete
before delete on public.properties
for each row execute function public.refuse_hard_delete();
create trigger refuse_hard_delete
before delete on public.stories
for each row execute function public.refuse_hard_delete();
create trigger refuse_hard_delete
before delete on public.subscribers
for each row execute function public.refuse_hard_delete();
create trigger refuse_hard_delete
before delete on public.submissions
for each row execute function public.refuse_hard_delete();
create trigger refuse_hard_delete
before delete on public.contacts
for each row execute function public.refuse_hard_delete();
create trigger refuse_hard_delete
before delete on public.inquiries
for each row execute function public.refuse_hard_delete();
create trigger refuse_hard_delete
before delete on public.payments
for each row execute function public.refuse_hard_delete();
create trigger refuse_hard_delete
before delete on public.campaigns
for each row execute function public.refuse_hard_delete();

-- Architecture 3.8: execute for service_role only. enforce_publish_gate runs as the caller and calls role_in, which
-- keeps its own grants.
revoke execute on function public.submission_transition_allowed(public.submission_state, public.submission_state),
  public.editorial_transition_allowed(public.editorial_state, public.editorial_state),
  public.enforce_editorial_gate(), public.enforce_editorial_state_order(), public.enforce_publish_gate(),
  public.enforce_slug_immutable(), public.properties_version_bump(), public.save_property(uuid, int, jsonb),
  public.refuse_hard_delete()
from public, anon, authenticated;
grant execute on function public.submission_transition_allowed(public.submission_state, public.submission_state),
  public.editorial_transition_allowed(public.editorial_state, public.editorial_state),
  public.save_property(uuid, int, jsonb)
to service_role;
