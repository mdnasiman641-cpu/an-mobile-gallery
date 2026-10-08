-- =====================================================================
-- 0001 · Extensions and shared helper functions
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Keep updated_at current on every UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- URL slug: lowercase ASCII words joined by hyphens.
-- "Apple iPhone 15 Pro Max 256GB" -> "apple-iphone-15-pro-max-256gb"
create or replace function public.slugify(input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(trim(coalesce(input, ''))), '[^a-z0-9]+', '-', 'g'),
      '(^-+|-+$)', '', 'g'
    ),
    ''
  );
$$;

-- Generic BEFORE INSERT/UPDATE trigger for tables with (id, name, slug):
-- fills a missing slug from the name, normalises it, and makes it unique
-- by appending -2, -3 ... This is what makes product URLs automatic.
create or replace function public.ensure_unique_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  base_slug text;
  candidate text;
  n int := 1;
  taken boolean;
begin
  if tg_op = 'UPDATE' and new.slug is not distinct from old.slug and new.slug is not null and new.slug <> '' then
    return new;
  end if;

  base_slug := public.slugify(coalesce(nullif(new.slug, ''), new.name));
  if base_slug is null then
    -- e.g. a name written only in Bangla script
    base_slug := 'item-' || substr(md5(gen_random_uuid()::text), 1, 6);
  end if;
  base_slug := left(base_slug, 120);
  candidate := base_slug;

  loop
    execute format('select exists(select 1 from %I.%I where slug = $1 and id <> $2)', tg_table_schema, tg_table_name)
      into taken
      using candidate, new.id;
    exit when not taken;
    n := n + 1;
    candidate := base_slug || '-' || n;
  end loop;

  new.slug := candidate;
  return new;
end;
$$;
