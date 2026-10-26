-- down:
--   update public.properties set video = video - 'uploadedAt' where video ? 'uploadedAt';
set lock_timeout = '5s';

-- C02: attach_reel now writes `uploadedAt`, the moment it attaches a film (the VideoObject's uploadDate). A film attached
-- before it gets the time of the audit row that attached that same film; a film with no such row keeps none, because a
-- date is never guessed. The one update fires the properties triggers as attach_reel's own update does.
update public.properties p
set video = p.video || jsonb_build_object(
  'uploadedAt', to_char(a.at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
)
from (
  select distinct on (l.entity_id) l.entity_id, l.at, l.after
  from public.audit_log l
  where l.action = 'properties.video_attach' and l.entity = 'properties'
  order by l.entity_id, l.at desc
) a
where a.entity_id = p.id
  and p.video is not null
  and not (p.video ? 'uploadedAt')
  and a.after -> 'video' ->> 'src' = p.video ->> 'src';
