-- down: re-run bun run db:fn approve_asset auto_approve_asset schedule_social_post set_social_post_inflight mark_social_post_posted fail_social_post mark_social_post_withdrawn record_channel_usage reschedule_social_post set_social_post_metrics retry_social_post cancel_social_post refresh_social_post_metrics store_channel_token record_channel_check put_channel_ids email_campaign_report upsert_campaign_report from the previous commit of supabase/sql/functions/approve_asset.sql, supabase/sql/functions/auto_approve_asset.sql, supabase/sql/functions/schedule_social_post.sql, supabase/sql/functions/set_social_post_inflight.sql, supabase/sql/functions/mark_social_post_posted.sql, supabase/sql/functions/fail_social_post.sql, supabase/sql/functions/mark_social_post_withdrawn.sql, supabase/sql/functions/record_channel_usage.sql, supabase/sql/functions/reschedule_social_post.sql, supabase/sql/functions/set_social_post_metrics.sql, supabase/sql/functions/retry_social_post.sql, supabase/sql/functions/cancel_social_post.sql, supabase/sql/functions/refresh_social_post_metrics.sql, supabase/sql/functions/store_channel_token.sql, supabase/sql/functions/record_channel_check.sql, supabase/sql/functions/put_channel_ids.sql, supabase/sql/functions/email_campaign_report.sql, supabase/sql/functions/upsert_campaign_report.sql
set lock_timeout = '5s';

drop function if exists public.approve_asset(p_asset uuid, p_actor uuid, p_actor_kind public.actor_kind, p_request_id text);

create or replace function public.approve_asset(
  p_asset uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text default null,
  p_evidence jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.assets;
  v_tier public.campaign_tier;
  v_market text;
begin
  -- B10 invariant 4: an agent, or the system (a null actor and kind, G43), approves only with the evidence of
  -- mayApprove; that evidence is kept in the audit row's note.
  if p_actor_kind is distinct from 'human' and p_evidence is null then
    raise exception 'manual_approval' using errcode = '42501';
  end if;
  select * into v_asset from public.assets a where a.id = p_asset for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_asset.status <> 'pending' then
    raise exception 'asset_not_pending' using errcode = '55000';
  end if;
  select p.campaign_tier, p.market_slug into v_tier, v_market
  from public.properties p
  where p.id = v_asset.property_id;

  -- The guard trigger assets_approve_guard runs here and refuses an incomplete asset.
  update public.assets set status = 'approved', approved_by = p_actor, approved_at = now() where id = p_asset;

  -- G6: an approved cover is the property's Open Graph image. A cover with no main file leaves the key as it is.
  if v_asset.kind = 'cover' then
    update public.properties p
    set og_image_key = coalesce(
      (select f ->> 'media_key' from jsonb_array_elements(v_asset.files) f where f ->> 'role' = 'main' limit 1),
      p.og_image_key
    )
    where p.id = v_asset.property_id;
  end if;

  insert into public.audit_log (actor_id, actor_kind, action, entity, entity_id, before, after, request_id, note)
  values (
    p_actor, p_actor_kind, 'assets.approve', 'assets', p_asset,
    jsonb_build_object('status', v_asset.status), jsonb_build_object('status', 'approved'), p_request_id,
    p_evidence::text
  );
  return public.emit_event(
    'asset.approved', 'asset', p_asset,
    jsonb_build_object(
      'asset_id', p_asset, 'property_id', v_asset.property_id, 'kind', v_asset.kind, 'tier', v_tier, 'market', v_market
    ),
    p_actor
  );
end;
$$;

revoke execute on function public.approve_asset(uuid, uuid, public.actor_kind, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.approve_asset(uuid, uuid, public.actor_kind, text, jsonb) to service_role;

create or replace function public.auto_approve_asset(p_asset_id uuid, p_evidence jsonb, p_request_id text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
begin
  -- B10 invariant 4: the system approves with evidence through B9's function, the only writer of the approval and the
  -- only emitter of asset.approved (G20); this row says the system did it (G43).
  v_event := public.approve_asset(
    p_asset => p_asset_id, p_actor => null, p_actor_kind => null, p_request_id => p_request_id, p_evidence => p_evidence
  );
  perform public.write_audit(
    null, null, 'assets.auto_approve', 'assets', p_asset_id, null, p_evidence, p_request_id, 'system'
  );
  return v_event;
end;
$$;

revoke execute on function public.auto_approve_asset(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.auto_approve_asset(uuid, jsonb, text) to service_role;

create or replace function public.schedule_social_post(p_asset_id uuid, p_channel text, p_scheduled_at timestamptz)
returns public.social_posts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.social_posts;
begin
  -- B10 invariant 2: one row per asset and channel; a second run reads the row the first one made.
  insert into public.social_posts (asset_id, property_id, channel, scheduled_at)
  select a.id, a.property_id, p_channel, p_scheduled_at
  from public.assets a
  where a.id = p_asset_id
  on conflict (asset_id, channel) do nothing
  returning * into v_post;
  if v_post.id is null then
    select * into v_post from public.social_posts p where p.asset_id = p_asset_id and p.channel = p_channel;
  end if;
  if v_post.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return v_post;
end;
$$;

revoke execute on function public.schedule_social_post(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.schedule_social_post(uuid, text, timestamptz) to service_role;

create or replace function public.set_social_post_inflight(p_id uuid, p_marker text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- INT-01: a compare-and-set. False means another run already holds the row with its own marker; no marker clears it.
  if p_marker is null then
    update public.social_posts set error = null where id = p_id and status = 'scheduled';
    return true;
  end if;
  update public.social_posts
  set error = p_marker
  where id = p_id
    and status = 'scheduled'
    and (error is null or (error not like 'inflight:%' and error not like 'container:%'));
  return found;
end;
$$;

revoke execute on function public.set_social_post_inflight(uuid, text) from public, anon, authenticated;
grant execute on function public.set_social_post_inflight(uuid, text) to service_role;

create or replace function public.mark_social_post_posted(
  p_id uuid,
  p_remote_id text,
  p_permalink text,
  p_targets text[]
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.social_posts;
  v_asset public.assets;
  v_submission public.submissions;
  v_posted_at timestamptz;
begin
  -- The stored posted_at, or null when the row was no longer scheduled (another run posted or failed it).
  select * into v_post from public.social_posts p where p.id = p_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- The asset row is the lock: two channels finishing at once cannot both miss the last one.
  select * into v_asset from public.assets a where a.id = v_post.asset_id for update;
  update public.social_posts
  set status = 'posted', posted_at = now(), remote_id = p_remote_id, permalink = p_permalink, error = null
  where id = p_id and status = 'scheduled'
  returning posted_at into v_posted_at;
  if not found then
    return null;
  end if;

  -- Published once every enabled target channel the caller names has a posted row for this asset.
  if v_asset.status = 'approved' and not exists (
    select 1
    from unnest(p_targets) t (channel)
    where not exists (
      select 1 from public.social_posts p
      where p.asset_id = v_asset.id and p.channel = t.channel and p.status = 'posted'
    )
  ) then
    update public.assets set status = 'published' where id = v_asset.id;
  end if;

  -- G60: the first posted row of a published property moves its submission to Distribution Active; B2's
  -- enforce_editorial_gate checks the move again.
  select s.* into v_submission
  from public.properties pr
  join public.submissions s on s.id = pr.submission_id
  where pr.id = v_asset.property_id
  for update of s;
  if found and v_submission.workflow_state = 'Published'
    and public.submission_transition_allowed('Published', 'Distribution Active') then
    update public.submissions set workflow_state = 'Distribution Active' where id = v_submission.id;
  end if;
  return v_posted_at;
end;
$$;

revoke execute on function public.mark_social_post_posted(uuid, text, text, text[]) from public, anon, authenticated;
grant execute on function public.mark_social_post_posted(uuid, text, text, text[]) to service_role;

create or replace function public.fail_social_post(p_id uuid, p_error text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- INT-01: only a scheduled row fails, so a run that lost a race never fails a row another run posted.
  update public.social_posts set status = 'failed', error = p_error where id = p_id and status = 'scheduled';
  return found;
end;
$$;

revoke execute on function public.fail_social_post(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_social_post(uuid, text) to service_role;

create or replace function public.mark_social_post_withdrawn(
  p_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.social_posts;
  v_withdrawn_at timestamptz;
begin
  -- E2E-01: a person deleted a taken-down post on the platform by hand and records it here.
  select * into v_post from public.social_posts p where p.id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_post.withdraw_required_at is null or v_post.withdrawn_at is not null then
    raise exception 'invalid_state' using errcode = '55000';
  end if;
  update public.social_posts set withdrawn_at = now() where id = p_id returning withdrawn_at into v_withdrawn_at;
  perform public.write_audit(
    p_actor, p_actor_kind, 'channels.mark_withdrawn', 'social_posts', p_id,
    jsonb_build_object('withdrawn_at', null), jsonb_build_object('withdrawn_at', v_withdrawn_at), p_request_id
  );
end;
$$;

revoke execute on function public.mark_social_post_withdrawn(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.mark_social_post_withdrawn(uuid, uuid, public.actor_kind, text) to service_role;

create or replace function public.record_channel_usage(p_channel text, p_reads int)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month text := to_char(now() at time zone 'UTC', 'YYYY-MM');
  v_reads int;
begin
  -- INT-08: the month's X reads; a new UTC month starts the count again. `x` is not a public key (G21).
  if p_channel is distinct from 'x' then
    raise exception 'validation' using errcode = '22023';
  end if;
  insert into public.settings as s (key, value)
  values (p_channel, jsonb_build_object('usage', jsonb_build_object('month', v_month, 'reads', p_reads)))
  on conflict (key) do update
  set value = s.value || jsonb_build_object(
    'usage', jsonb_build_object(
      'month', v_month,
      'reads', p_reads + case
        when s.value -> 'usage' ->> 'month' = v_month then coalesce((s.value -> 'usage' ->> 'reads')::int, 0)
        else 0
      end
    )
  )
  returning (value -> 'usage' ->> 'reads')::int into v_reads;
  return v_reads;
end;
$$;

revoke execute on function public.record_channel_usage(text, int) from public, anon, authenticated;
grant execute on function public.record_channel_usage(text, int) to service_role;

create or replace function public.reschedule_social_post(p_id uuid, p_scheduled_at timestamptz, p_note text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before timestamptz;
begin
  -- Invariant 3a: a temporary failure near the window end moves the post; the system writes the row (G43).
  select p.scheduled_at into v_before from public.social_posts p where p.id = p_id and p.status = 'scheduled' for update;
  if not found then
    return false;
  end if;
  update public.social_posts set scheduled_at = p_scheduled_at where id = p_id;
  perform public.write_audit(
    null, null, 'channels.reschedule', 'social_posts', p_id,
    jsonb_build_object('scheduled_at', v_before), jsonb_build_object('scheduled_at', p_scheduled_at), null, p_note
  );
  return true;
end;
$$;

revoke execute on function public.reschedule_social_post(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.reschedule_social_post(uuid, timestamptz, text) to service_role;

create or replace function public.set_social_post_metrics(p_id uuid, p_metrics jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.social_posts set metrics = p_metrics where id = p_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.set_social_post_metrics(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_social_post_metrics(uuid, jsonb) to service_role;

create or replace function public.retry_social_post(
  p_id uuid,
  p_force boolean,
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
  v_post public.social_posts;
  v_asset public.assets;
  v_tier public.campaign_tier;
  v_market text;
  v_type text;
  v_job uuid;
begin
  select * into v_post from public.social_posts p where p.id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_post.status <> 'failed' then
    raise exception 'wrong_state' using errcode = '55000';
  end if;
  v_type := case v_post.channel
    when 'instagram' then 'post_meta'
    when 'facebook' then 'post_meta'
    when 'x' then 'post_x'
    when 'linkedin' then 'post_linkedin'
  end;
  if v_type is null then
    raise exception 'no_adapter' using errcode = '22023';
  end if;
  select * into v_asset from public.assets a where a.id = v_post.asset_id;
  select p.campaign_tier, p.market_slug into v_tier, v_market from public.properties p where p.id = v_asset.property_id;

  -- A retry clears the error, the in-flight marker included; `force` skips the revision check (invariant 2).
  update public.social_posts set status = 'scheduled', error = null where id = p_id;
  v_job := public.enqueue_job_manual(
    v_type, p_id,
    jsonb_build_object(
      'params', case
        when v_type = 'post_meta' then jsonb_build_object('channels', jsonb_build_array(v_post.channel))
        else '{}'::jsonb
      end,
      'data', jsonb_build_object(
        'asset_id', v_asset.id, 'property_id', v_asset.property_id, 'kind', v_asset.kind, 'tier', v_tier,
        'market', v_market, 'force', p_force
      )
    ),
    12
  );
  -- DB-09: no job means no retry, so the state change and the audit row roll back with this raise.
  if v_job is null then
    raise exception 'enqueue_failed' using errcode = '55000';
  end if;
  perform public.write_audit(
    p_actor, p_actor_kind, 'channels.retry', 'social_posts', p_id,
    jsonb_build_object('status', v_post.status, 'error', v_post.error),
    jsonb_build_object('status', 'scheduled', 'error', null),
    p_request_id, format('force: %s', p_force)
  );
  return v_job;
end;
$$;

revoke execute on function public.retry_social_post(uuid, boolean, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.retry_social_post(uuid, boolean, uuid, public.actor_kind, text) to service_role;

create or replace function public.cancel_social_post(
  p_id uuid,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.social_posts;
begin
  -- Invariant 2: a cancelled post is failed with `cancelled`; a job still waiting for it ends skipped.
  select * into v_post from public.social_posts p where p.id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_post.status <> 'scheduled' then
    raise exception 'wrong_state' using errcode = '55000';
  end if;
  update public.social_posts set status = 'failed', error = 'cancelled' where id = p_id;
  perform public.write_audit(
    p_actor, p_actor_kind, 'channels.cancel', 'social_posts', p_id,
    jsonb_build_object('status', v_post.status, 'error', v_post.error),
    jsonb_build_object('status', 'failed', 'error', 'cancelled'),
    p_request_id
  );
end;
$$;

revoke execute on function public.cancel_social_post(uuid, uuid, public.actor_kind, text) from public, anon, authenticated;
grant execute on function public.cancel_social_post(uuid, uuid, public.actor_kind, text) to service_role;

create or replace function public.refresh_social_post_metrics(
  p_id uuid,
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
  v_status public.social_post_status;
  v_job uuid;
begin
  -- Invariant 1: the admin never calls a platform; the reconcile job reads this one post's metrics.
  select p.status into v_status from public.social_posts p where p.id = p_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_status <> 'posted' then
    raise exception 'wrong_state' using errcode = '55000';
  end if;
  v_job := public.enqueue_job_manual(
    'reconcile', p_id,
    jsonb_build_object('params', jsonb_build_object('post_ids', jsonb_build_array(p_id)), 'data', '{}'::jsonb)
  );
  -- DB-09: no job means nothing was asked, so the audit row rolls back with this raise.
  if v_job is null then
    raise exception 'enqueue_failed' using errcode = '55000';
  end if;
  perform public.write_audit(
    p_actor, p_actor_kind, 'channels.metrics_refresh', 'social_posts', p_id, null,
    jsonb_build_object('job_id', v_job), p_request_id
  );
  return v_job;
end;
$$;

revoke execute on function public.refresh_social_post_metrics(uuid, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.refresh_social_post_metrics(uuid, uuid, public.actor_kind, text) to service_role;

create or replace function public.store_channel_token(
  p_channel text,
  p_used_refresh_sha256 text,
  p_token_set jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
  v_name text;
begin
  if p_channel not in ('x', 'linkedin') then
    raise exception 'validation' using errcode = '22023';
  end if;
  -- G21: one writer per channel, the lock ends with the transaction; no lease table.
  if not pg_try_advisory_xact_lock(hashtext('token_refresh:' || p_channel)) then
    return 'busy';
  end if;
  -- A refresh token is used once: a set refreshed from another token than the one stored now is stale. An empty
  -- entry is the env seed, whose hash only the caller knows.
  v_current := public.get_vault_secret(p_channel || '_oauth_token');
  if coalesce(v_current, '') <> ''
    and encode(sha256(convert_to(coalesce(v_current::jsonb ->> 'refresh_token', ''), 'UTF8')), 'hex')
      is distinct from p_used_refresh_sha256 then
    return 'stale';
  end if;
  perform public.set_vault_secret(p_channel || '_oauth_token', p_token_set::text);
  v_name := case p_channel when 'x' then 'X_ACCESS_TOKEN' else 'LINKEDIN_ACCESS_TOKEN' end;
  insert into public.audit_log (actor_id, actor_kind, action, entity, note)
  values (null, null, 'secret.rotated', v_name, v_name || ': automatic refresh');
  return 'stored';
end;
$$;

revoke execute on function public.store_channel_token(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.store_channel_token(text, text, jsonb) to service_role;

create or replace function public.record_channel_check(
  p_channel text,
  p_expires_at timestamptz,
  p_checked_at timestamptz,
  p_state text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patch jsonb;
begin
  if p_channel not in ('x', 'linkedin') or p_state not in ('ok', 'dead', 'version_expired') then
    raise exception 'validation' using errcode = '22023';
  end if;
  -- Every other key of the channel's settings stays (ids, usage); only `ok` moves the expiry and the check time.
  v_patch := jsonb_build_object('token_state', p_state) || case
    when p_state = 'ok' then jsonb_build_object('token_expires_at', p_expires_at, 'token_checked_at', p_checked_at)
    else '{}'::jsonb
  end;
  insert into public.settings as s (key, value)
  values (p_channel, v_patch)
  on conflict (key) do update set value = s.value || v_patch;
end;
$$;

revoke execute on function public.record_channel_check(text, timestamptz, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.record_channel_check(text, timestamptz, timestamptz, text) to service_role;

create or replace function public.put_channel_ids(
  p_key text,
  p_value jsonb,
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed text[];
  v_before jsonb;
  v_after jsonb;
begin
  -- G21: the non-secret ids of a channel. Only the fields of channelIdsSchema pass, so no token reaches settings;
  -- these keys are not public, so catalog_version does not move.
  v_allowed := case p_key
    when 'meta' then array['page_id', 'ig_user_id', 'graph_version']
    when 'x' then array['user_id', 'handle', 'read_allowance', 'metrics_days']
    when 'linkedin' then array['organization_urn', 'api_version', 'multi_image']
  end;
  if v_allowed is null or jsonb_typeof(p_value) is distinct from 'object' then
    raise exception 'validation' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_value) k where k <> all (v_allowed)) then
    raise exception 'unknown_field' using errcode = '22023';
  end if;
  select s.value into v_before from public.settings s where s.key = p_key for update;
  insert into public.settings as s (key, value, updated_by)
  values (p_key, p_value, p_actor)
  on conflict (key) do update set value = s.value || excluded.value, updated_by = excluded.updated_by
  returning value into v_after;
  perform public.write_audit(
    p_actor, p_actor_kind, 'channels.ids_put', 'settings', null, coalesce(v_before, '{}'::jsonb), v_after,
    p_request_id, case when p_actor is null then 'system' end
  );
  return v_after;
end;
$$;

revoke execute on function public.put_channel_ids(text, jsonb, uuid, public.actor_kind, text)
  from public, anon, authenticated;
grant execute on function public.put_channel_ids(text, jsonb, uuid, public.actor_kind, text) to service_role;

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
