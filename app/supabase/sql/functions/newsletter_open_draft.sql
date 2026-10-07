create or replace function public.newsletter_open_draft()
returns public.newsletter_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issue public.newsletter_issues;
begin
  -- The one open draft, locked, made when there is none: the next number, sent a fortnight after the last issue, else
  -- at the digest clock, else in 14 days. A concurrent maker meets the single-draft index and its draft is read.
  select * into v_issue from public.newsletter_issues i where i.status = 'draft' for update;
  if found then
    return v_issue;
  end if;
  insert into public.newsletter_issues (number, scheduled_for)
  select coalesce(max(i.number), 0) + 1,
    coalesce(
      max(i.sent_at) + interval '14 days',
      (select s.next_run_at from public.schedule_settings s where s.key = 'digest'),
      now() + interval '14 days'
    )
  from public.newsletter_issues i
  on conflict do nothing
  returning * into v_issue;
  if v_issue.id is null then
    select * into v_issue from public.newsletter_issues i where i.status = 'draft' for update;
  end if;
  return v_issue;
end;
$$;

revoke execute on function public.newsletter_open_draft() from public, anon, authenticated;
