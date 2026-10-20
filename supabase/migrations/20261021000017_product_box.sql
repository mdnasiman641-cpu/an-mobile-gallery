-- 0017 · Box availability for products (Admin → Products bulk actions + product editor)
--
-- Adds products.box_included:
--   true  = sold with the original box (confirmed by an admin)
--   false = sold without the box (confirmed by an admin)
--   null  = not specified (every existing product; nothing is guessed)
-- Separate from products.warranty. Condition keeps using products.condition
-- (new / used / refurbished) and the category products.category_id.
--
-- The storefront card functions get one extra output column (box_included),
-- added at the END so existing callers keep working. Their return type
-- changes, so they are dropped and created again with the same arguments,
-- security mode and grants.
--
-- Safe to run more than once. Run in the Supabase SQL editor.

begin;

alter table public.products add column if not exists box_included boolean;
comment on column public.products.box_included is
  'Original box included: true = with box, false = without box, null = not specified. Set by staff only; never inferred.';

drop function if exists public.search_products(text, text[], text, numeric, numeric, text[], text[], text[], boolean, text, text, int, int);

create or replace function public.search_products(
  p_query text default null,
  p_brands text[] default null,
  p_category text default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_ram text[] default null,
  p_storage text[] default null,
  p_conditions text[] default null,
  p_in_stock boolean default null,
  p_flag text default null,
  p_sort text default 'relevance',
  p_limit int default 24,
  p_offset int default 0
)
returns table (
  id uuid,
  slug text,
  name text,
  brand_name text,
  brand_slug text,
  category_slug text,
  price numeric,
  sale_price numeric,
  stock_quantity int,
  low_stock_threshold int,
  condition text,
  status text,
  featured boolean,
  is_new boolean,
  is_offer boolean,
  is_best_seller boolean,
  image_url text,
  image_alt text,
  rating_avg numeric,
  rating_count int,
  ram_options text[],
  storage_options text[],
  created_at timestamptz,
  rank real,
  box_included boolean,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with recursive
  params0 as (
    select public.build_search_tsquery(p_query) as tsq,
           nullif(btrim(left(p_query, 200)), '') as q
  ),
  -- Fuzzy (typo-tolerant) matching is only used when exact search finds nothing.
  params as (
    select p0.tsq, p0.q,
           (p0.q is not null and not exists (
             select 1 from public.products x
             where x.status in ('active', 'out_of_stock')
               and p0.tsq is not null and x.search_vector @@ p0.tsq
           )) as use_fuzzy
    from params0 p0
  ),
  cat_tree as (
    select c.id from public.categories c where p_category is not null and c.slug = p_category
    union all
    select c.id from public.categories c join cat_tree t on c.parent_id = t.id
  ),
  base as (
    select
      p.*,
      b.name as b_name,
      b.slug as b_slug,
      c.slug as c_slug,
      case
        when prm.q is null then 0::real
        else (
          case when prm.tsq is not null and p.search_vector @@ prm.tsq then ts_rank_cd(p.search_vector, prm.tsq) else 0 end
          + case when prm.use_fuzzy then word_similarity(prm.q, p.name) else 0 end
        )::real
      end as rnk
    from public.products p
    cross join params prm
    left join public.brands b on b.id = p.brand_id
    left join public.categories c on c.id = p.category_id
    where p.status in ('active', 'out_of_stock')
      and (
        prm.q is null
        or (prm.tsq is not null and p.search_vector @@ prm.tsq)
        or (prm.use_fuzzy and char_length(prm.q) >= 3 and word_similarity(prm.q, p.name) >= 0.45)
      )
      and (p_brands is null or cardinality(p_brands) = 0 or b.slug = any (p_brands))
      and (p_category is null or p.category_id in (select ct.id from cat_tree ct))
      and (p_min_price is null or coalesce(p.sale_price, p.price) >= p_min_price)
      and (p_max_price is null or coalesce(p.sale_price, p.price) <= p_max_price)
      and (p_ram is null or cardinality(p_ram) = 0 or p.ram_options && p_ram)
      and (p_storage is null or cardinality(p_storage) = 0 or p.storage_options && p_storage)
      and (p_conditions is null or cardinality(p_conditions) = 0 or p.condition = any (p_conditions))
      and (
        p_in_stock is null
        or (p_in_stock and p.status = 'active' and p.stock_quantity > 0)
        or (not p_in_stock and (p.status = 'out_of_stock' or p.stock_quantity = 0))
      )
      and (
        p_flag is null
        or (p_flag = 'featured' and p.featured)
        or (p_flag = 'new' and p.is_new)
        or (p_flag = 'offer' and (p.is_offer or p.sale_price is not null))
        or (p_flag = 'best_seller' and p.is_best_seller)
        or (p_flag = 'used' and p.condition in ('used', 'refurbished'))
      )
  )
  select
    base.id,
    base.slug,
    base.name,
    base.b_name,
    base.b_slug,
    base.c_slug,
    base.price,
    base.sale_price,
    base.stock_quantity,
    base.low_stock_threshold,
    base.condition,
    base.status,
    base.featured,
    base.is_new,
    base.is_offer,
    base.is_best_seller,
    img.url,
    img.alt_text,
    base.rating_avg,
    base.rating_count,
    base.ram_options,
    base.storage_options,
    base.created_at,
    base.rnk,
    base.box_included,
    count(*) over () as total_count
  from base
  left join lateral (
    select i.url, i.alt_text
    from public.product_images i
    where i.product_id = base.id
    order by i.is_primary desc, i.sort_order asc
    limit 1
  ) img on true
  order by
    case when p_sort = 'price_asc' then coalesce(base.sale_price, base.price) end asc nulls last,
    case when p_sort = 'price_desc' then coalesce(base.sale_price, base.price) end desc nulls last,
    case when p_sort = 'newest' then base.created_at end desc nulls last,
    case when p_sort = 'popular' then base.sales_count * 5 + base.view_count end desc nulls last,
    case when coalesce(p_sort, 'relevance') = 'relevance' then base.rnk end desc nulls last,
    (base.status = 'active' and base.stock_quantity > 0) desc,
    base.featured desc,
    base.created_at desc
  limit least(greatest(coalesce(p_limit, 24), 1), 60)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke execute on function public.search_products(text, text[], text, numeric, numeric, text[], text[], text[], boolean, text, text, int, int) from public;
grant execute on function public.search_products(text, text[], text, numeric, numeric, text[], text[], text[], boolean, text, text, int, int) to anon, authenticated;

drop function if exists public.product_cards_by_ids(uuid[]);

create or replace function public.product_cards_by_ids(p_ids uuid[])
returns table (
  id uuid, slug text, name text, brand_name text, brand_slug text, category_slug text,
  price numeric, sale_price numeric, stock_quantity int, low_stock_threshold int,
  condition text, status text, featured boolean, is_new boolean, is_offer boolean, is_best_seller boolean,
  image_url text, image_alt text, rating_avg numeric, rating_count int,
  ram_options text[], storage_options text[], created_at timestamptz,
  box_included boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select p.id, p.slug, p.name, b.name, b.slug, c.slug,
         p.price, p.sale_price, p.stock_quantity, p.low_stock_threshold,
         p.condition, p.status, p.featured, p.is_new, p.is_offer, p.is_best_seller,
         img.url, img.alt_text, p.rating_avg, p.rating_count,
         p.ram_options, p.storage_options, p.created_at,
         p.box_included
  from unnest(p_ids[1:60]) with ordinality as wanted(pid, ord)
  join public.products p on p.id = wanted.pid
  left join public.brands b on b.id = p.brand_id
  left join public.categories c on c.id = p.category_id
  left join lateral (
    select i.url, i.alt_text from public.product_images i
    where i.product_id = p.id
    order by i.is_primary desc, i.sort_order asc
    limit 1
  ) img on true
  where p.status in ('active', 'out_of_stock')
  order by wanted.ord;
$$;

revoke execute on function public.product_cards_by_ids(uuid[]) from public;
grant execute on function public.product_cards_by_ids(uuid[]) to anon, authenticated;

commit;

-- PostgREST picks up the new column and function signatures automatically
-- (Supabase reloads its schema cache on DDL). If not, run: notify pgrst, 'reload schema';
