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
