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
