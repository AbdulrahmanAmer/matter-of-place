create or replace function public.assets_approve_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_missing text;
begin
  -- B9 invariant 4: what each kind needs before a human may approve it. The first missing part names itself.
  if new.kind in ('cover', 'carousel', 'story', 'reel') then
    v_missing := case
      when jsonb_array_length(new.files) = 0 then 'files'
      when coalesce(btrim(new.caption), '') = '' then 'caption'
      when coalesce(btrim(new.alt_text), '') = '' then 'alt_text'
    end;
    if v_missing is null and new.meta ->> 'caption_lint' = 'failed' then
      raise exception 'caption_lint_failed' using errcode = '23514';
    end if;
  elsif new.kind = 'newsletter_block' then
    v_missing := case
      when coalesce(btrim(new.meta #>> '{block,title}'), '') = '' then 'meta.block.title'
      when coalesce(btrim(new.meta #>> '{block,deck}'), '') = '' then 'meta.block.deck'
      when coalesce(btrim(new.meta #>> '{block,image_key}'), '') = '' then 'meta.block.image_key'
      when coalesce(btrim(new.meta #>> '{block,image_url}'), '') = '' then 'meta.block.image_url'
      when coalesce(btrim(new.alt_text), '') = '' then 'alt_text'
    end;
  elsif new.kind = 'standalone_email' then
    v_missing := case
      when coalesce(btrim(new.meta ->> 'subject'), '') = '' then 'meta.subject'
      when coalesce(btrim(new.meta ->> 'preheader'), '') = '' then 'meta.preheader'
      when jsonb_typeof(new.meta -> 'block') is distinct from 'object' or new.meta -> 'block' = '{}'::jsonb
        then 'meta.block'
    end;
  else
    v_missing := 'kind';
  end if;
  if v_missing is not null then
    raise exception 'asset_incomplete' using errcode = '23514', detail = v_missing;
  end if;
  return new;
end;
$$;

revoke execute on function public.assets_approve_guard() from public, anon, authenticated;

create or replace trigger assets_approve_guard
before update on public.assets
for each row when (new.status = 'approved' and old.status is distinct from 'approved')
execute function public.assets_approve_guard();
