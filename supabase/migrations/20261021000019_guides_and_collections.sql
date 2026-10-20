-- 0019 · Buying guides (Admin → Guides) and the homepage "Headline & Shop by
-- Collection" section.
--
-- 1. public.articles: guides / articles shown at /guides/<slug>.
--    Visitors can read an article only when it is published and its
--    publication date has arrived; drafts are never readable from the site.
--    Staff (admin / editor) manage them, like Admin → Pages.
-- 2. homepage_sections: allows the new "collections" section key and adds its
--    row (switched on, at the top). Every other section keeps its settings.
--
-- Safe to run more than once. Run in the Supabase SQL editor.

begin;

-- 1 · Articles -------------------------------------------------------------

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  title text not null check (char_length(title) between 3 and 200),
  excerpt text check (excerpt is null or char_length(excerpt) <= 320),
  content text not null default '' check (char_length(content) <= 100000),
  meta_title text check (meta_title is null or char_length(meta_title) <= 120),
  meta_description text check (meta_description is null or char_length(meta_description) <= 320),
  featured_image text check (featured_image is null or (char_length(featured_image) <= 1000 and featured_image ~ '^(https://|/)')),
  featured_image_alt text check (featured_image_alt is null or char_length(featured_image_alt) <= 200),
  topics text[] not null default '{}' check (cardinality(topics) <= 10),
  related_product_ids uuid[] not null default '{}' check (cardinality(related_product_ids) <= 12),
  related_category_ids uuid[] not null default '{}' check (cardinality(related_category_ids) <= 12),
  canonical_url text check (canonical_url is null or (char_length(canonical_url) <= 500 and canonical_url ~ '^https://')),
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  author_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint articles_published_has_date check (status = 'draft' or published_at is not null)
);

create index if not exists articles_public_idx on public.articles (status, published_at desc);

drop trigger if exists articles_updated_at on public.articles;
create trigger articles_updated_at before update on public.articles
  for each row execute function public.set_updated_at();

alter table public.articles enable row level security;

drop policy if exists "articles: public read published" on public.articles;
create policy "articles: public read published" on public.articles for select to anon, authenticated
  using ((status = 'published' and published_at <= now()) or (select public.is_staff()));

drop policy if exists "articles: staff write" on public.articles;
create policy "articles: staff write" on public.articles for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

revoke all on table public.articles from anon;
grant select on table public.articles to anon;
grant select, insert, update, delete on table public.articles to authenticated;

-- 2 · Homepage section "collections" -----------------------------------------

alter table public.homepage_sections drop constraint if exists homepage_sections_key_check;
alter table public.homepage_sections add constraint homepage_sections_key_check check (key in (
  'collections',
  'hero', 'deals', 'trust', 'categories', 'exchange', 'emi', 'offers', 'featured',
  'new_arrivals', 'used', 'refurbished', 'accessories', 'best_sellers', 'brands',
  'promotions', 'reviews', 'why', 'footer_promo'
));

insert into public.homepage_sections (key, position, is_enabled, mode)
values ('collections', 0, true, 'auto')
on conflict (key) do nothing;

commit;
