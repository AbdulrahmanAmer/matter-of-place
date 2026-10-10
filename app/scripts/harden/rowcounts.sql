-- The row counts both restore drills compare (H1 step 6 and 6b): one line `<table> <count>` per table when run with
-- `psql -qAt -F ' '`, on the source and on the restored side.
select t.name, t.n
from (
  values
    (1, 'properties', (select count(*) from public.properties)),
    (2, 'submissions', (select count(*) from public.submissions)),
    (3, 'subscribers', (select count(*) from public.subscribers)),
    (4, 'audit_log', (select count(*) from public.audit_log)),
    (5, 'payments', (select count(*) from public.payments)),
    (6, 'jobs', (select count(*) from public.jobs))
) as t (ord, name, n)
order by t.ord;
