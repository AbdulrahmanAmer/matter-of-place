create or replace function public.enforce_submission_media_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- GQ-07: the row lock makes concurrent inserts for one submission run one after another, so the count is exact.
  perform 1 from public.submissions where id = new.submission_id for update;
  if (select count(*) from public.submission_media where submission_id = new.submission_id) >= 40 then
    raise exception 'upload_limit';
  end if;
  return new;
end;
$$;
