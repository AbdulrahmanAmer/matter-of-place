create or replace function public.complete_distributed_submissions(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_moved integer := 0;
begin
  -- G60, DL-09: a Published or Distribution Active submission completes once its campaign's ends_on is before p_now's
  -- UTC date, or, when the property has no campaign or no campaign with an end (a product with no window, ruling H17),
  -- 30 days after the property was published. Each move is checked again by enforce_editorial_gate.
  for v_row in
    select s.id, s.workflow_state
    from public.submissions s
    join public.properties pr on pr.submission_id = s.id
    where s.workflow_state in ('Published', 'Distribution Active')
      and (
        exists (
          select 1 from public.campaigns c
          where c.property_id = pr.id and c.ends_on < (p_now at time zone 'utc')::date
        )
        or (
          not exists (select 1 from public.campaigns c where c.property_id = pr.id and c.ends_on is not null)
          and pr.published_at <= p_now - interval '30 days'
        )
      )
    order by s.id
    for update of s
  loop
    if public.submission_transition_allowed(v_row.workflow_state, 'Completed') then
      update public.submissions set workflow_state = 'Completed' where id = v_row.id;
      v_moved := v_moved + 1;
    end if;
  end loop;
  return v_moved;
end;
$$;

revoke execute on function public.complete_distributed_submissions(timestamptz) from public, anon, authenticated;
grant execute on function public.complete_distributed_submissions(timestamptz) to service_role;
