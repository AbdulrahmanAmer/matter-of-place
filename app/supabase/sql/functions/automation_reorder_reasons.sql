create or replace function public.automation_reorder_reasons(
  p_ids uuid[],
  p_actor uuid,
  p_actor_kind public.actor_kind,
  p_request_id text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  -- The list names every reason exactly once.
  if (select array_agg(r.id order by r.id) from public.decline_reasons r)
    is distinct from (select array_agg(u.id order by u.id) from unnest(p_ids) as u (id)) then
    raise exception 'reorder_mismatch' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object('id', r.id, 'sort', r.sort) order by r.sort, r.id) into v_before
  from public.decline_reasons r;
  -- Invariant 7: the revision trigger reads the actor of this transaction.
  perform set_config('mop.actor_id', coalesce(p_actor::text, ''), true);
  perform set_config('mop.actor_kind', coalesce(p_actor_kind::text, ''), true);
  perform set_config('mop.note', coalesce(p_note, ''), true);
  -- One statement; a row whose position is unchanged is not written, so it records no revision.
  update public.decline_reasons r
  set sort = o.position::int
  from unnest(p_ids) with ordinality as o (id, position)
  where r.id = o.id and r.sort is distinct from o.position::int;
  select jsonb_agg(jsonb_build_object('id', r.id, 'sort', r.sort) order by r.sort, r.id) into v_after
  from public.decline_reasons r;
  -- STUB(B8b step 6): unconditional write_audit
  if to_regproc('public.write_audit') is not null then
    perform public.write_audit(
      p_actor, p_actor_kind, 'automation.reasons_put', 'decline_reasons', null, v_before, v_after, p_request_id,
      p_note
    );
  end if;
end;
$$;

revoke execute on function public.automation_reorder_reasons(uuid[], uuid, public.actor_kind, text, text)
  from public, anon, authenticated;
grant execute on function public.automation_reorder_reasons(uuid[], uuid, public.actor_kind, text, text)
  to service_role;
