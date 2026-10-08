-- =====================================================================
-- 0002 · Users, admins and catalog tables
-- =====================================================================

-- Profile mirror of auth.users (one row per account, created by trigger).
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Staff accounts. Customers never get a row here.
--   super_admin: everything incl. managing staff
--   admin:       everything except staff management
--   editor:      catalog + content (products, brands, banners, reviews)
create table public.admin_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  role text not null default 'admin' check (role in ('super_admin', 'admin', 'editor')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  slug text not null unique,
  logo_url text,
  description text,
  meta_title text check (meta_title is null or char_length(meta_title) <= 120),
  meta_description text check (meta_description is null or char_length(meta_description) <= 320),
  is_featured boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories (id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  slug text not null unique,
  description text,
  image_url text,
  meta_title text check (meta_title is null or char_length(meta_title) <= 120),
  meta_description text check (meta_description is null or char_length(meta_description) <= 320),
  is_featured boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_not_own_parent check (parent_id is null or parent_id <> id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references public.brands (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,
  name text not null check (char_length(name) between 2 and 200),
  model text,
  slug text not null unique,
  sku text unique,
  barcode text,               -- GTIN / EAN / UPC
  mpn text,                   -- manufacturer part number
  short_description text check (short_description is null or char_length(short_description) <= 500),
  description text,
  price numeric(12, 2) not null default 0 check (price >= 0),
  sale_price numeric(12, 2) check (sale_price is null or sale_price >= 0),
  stock_quantity int not null default 0 check (stock_quantity >= 0),
  low_stock_threshold int not null default 3 check (low_stock_threshold >= 0),
  condition text not null default 'new' check (condition in ('new', 'used', 'refurbished')),
  status text not null default 'draft' check (status in ('active', 'draft', 'out_of_stock', 'archived')),
  featured boolean not null default false,
  is_new boolean not null default false,
  is_offer boolean not null default false,
  is_best_seller boolean not null default false,
  warranty text,
  meta_title text check (meta_title is null or char_length(meta_title) <= 120),
  meta_description text check (meta_description is null or char_length(meta_description) <= 320),
  canonical_url text,
  -- maintained automatically
  ram_options text[] not null default '{}',
  storage_options text[] not null default '{}',
  color_options text[] not null default '{}',
  rating_avg numeric(3, 2) not null default 0,
  rating_count int not null default 0,
  view_count int not null default 0,
  sales_count int not null default 0,
  search_vector tsvector,
  published_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_sale_below_price check (sale_price is null or sale_price < price)
);

-- Purchase cost is business-private: kept out of the publicly readable
-- products table and protected by admin-only RLS.
create table public.product_costs (
  product_id uuid primary key references public.products (id) on delete cascade,
  cost_price numeric(12, 2) check (cost_price is null or cost_price >= 0),
  supplier text,
  internal_note text,
  updated_at timestamptz not null default now()
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  sku text unique,
  storage text,
  ram text,
  color text,
  color_hex text check (color_hex is null or color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  price numeric(12, 2) not null check (price >= 0),
  sale_price numeric(12, 2) check (sale_price is null or sale_price >= 0),
  stock int not null default 0 check (stock >= 0),
  image_url text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint variants_sale_below_price check (sale_price is null or sale_price < price)
);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  url text not null,
  storage_path text,          -- path inside the "media" bucket, null for external/demo files
  alt_text text,
  is_primary boolean not null default false,
  sort_order int not null default 0,
  width int,
  height int,
  created_at timestamptz not null default now()
);

create table public.product_specifications (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  group_name text not null default 'General',
  name text not null check (char_length(name) between 1 and 80),
  value text not null check (char_length(value) between 1 and 500),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.product_features (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  feature text not null check (char_length(feature) between 1 and 300),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Inventory history (every stock movement is logged here).
create table public.inventory (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete set null,
  change int not null,
  stock_after int not null,
  reason text not null check (reason in ('initial', 'restock', 'sale', 'return', 'adjustment', 'order_cancelled', 'damage')),
  note text,
  order_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Old slug -> new slug, so renamed products/brands/categories 301-redirect.
create table public.slug_redirects (
  id uuid primary key default gen_random_uuid(),
  entity text not null check (entity in ('product', 'brand', 'category')),
  old_slug text not null,
  new_slug text not null,
  created_at timestamptz not null default now(),
  unique (entity, old_slug)
);

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------
create index brands_active_sort_idx on public.brands (is_active, sort_order);
create index categories_parent_idx on public.categories (parent_id);
create index categories_active_sort_idx on public.categories (is_active, sort_order);

create index products_brand_idx on public.products (brand_id);
create index products_category_idx on public.products (category_id);
create index products_status_idx on public.products (status);
create index products_created_idx on public.products (created_at desc);
create index products_flags_idx on public.products (status, featured, is_new, is_offer, is_best_seller);
create index products_condition_idx on public.products (condition);
create index products_effective_price_idx on public.products ((coalesce(sale_price, price)));
create index products_search_idx on public.products using gin (search_vector);
create index products_name_trgm_idx on public.products using gin (name extensions.gin_trgm_ops);
create index products_ram_idx on public.products using gin (ram_options);
create index products_storage_idx on public.products using gin (storage_options);
create index products_demo_idx on public.products (is_demo) where is_demo;

create index variants_product_idx on public.product_variants (product_id, sort_order);
create index images_product_idx on public.product_images (product_id, sort_order);
create unique index images_one_primary_idx on public.product_images (product_id) where is_primary;
create index specs_product_idx on public.product_specifications (product_id, sort_order);
create index features_product_idx on public.product_features (product_id, sort_order);
create index inventory_product_idx on public.inventory (product_id, created_at desc);
create index inventory_created_idx on public.inventory (created_at desc);
create index slug_redirects_new_idx on public.slug_redirects (entity, new_slug);

-- updated_at triggers
create trigger users_updated_at before update on public.users for each row execute function public.set_updated_at();
create trigger admin_users_updated_at before update on public.admin_users for each row execute function public.set_updated_at();
create trigger brands_updated_at before update on public.brands for each row execute function public.set_updated_at();
create trigger categories_updated_at before update on public.categories for each row execute function public.set_updated_at();
create trigger product_costs_updated_at before update on public.product_costs for each row execute function public.set_updated_at();
create trigger variants_updated_at before update on public.product_variants for each row execute function public.set_updated_at();

-- automatic unique slugs
create trigger brands_slug before insert or update of slug, name on public.brands for each row execute function public.ensure_unique_slug();
create trigger categories_slug before insert or update of slug, name on public.categories for each row execute function public.ensure_unique_slug();
create trigger products_slug before insert or update of slug on public.products for each row execute function public.ensure_unique_slug();
