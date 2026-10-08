-- =====================================================================
-- 0003 · Customers, orders, reviews, coupons, wishlists
-- =====================================================================

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete set null,
  full_name text not null default '',
  phone text,
  email text,
  address text,
  city text,
  area text,
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index customers_phone_idx on public.customers (phone) where phone is not null;

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(code) and code ~ '^[A-Z0-9_-]{3,30}$'),
  description text,
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value numeric(12, 2) not null check (discount_value > 0),
  min_order_amount numeric(12, 2) not null default 0 check (min_order_amount >= 0),
  max_discount_amount numeric(12, 2) check (max_discount_amount is null or max_discount_amount > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit int check (usage_limit is null or usage_limit > 0),
  used_count int not null default 0,
  is_active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_percent_range check (discount_type <> 'percent' or discount_value <= 100),
  constraint coupons_dates check (starts_at is null or ends_at is null or ends_at > starts_at)
);

create sequence public.order_number_seq start 1001;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid references public.customers (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  customer_name text not null,
  phone text not null,
  email text,
  address text not null,
  city text,
  area text,
  delivery_zone text not null default 'inside_dhaka' check (delivery_zone in ('inside_dhaka', 'outside_dhaka', 'store_pickup')),
  note text,
  subtotal numeric(12, 2) not null default 0,
  discount numeric(12, 2) not null default 0,
  delivery_charge numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  coupon_id uuid references public.coupons (id) on delete set null,
  coupon_code text,
  payment_method text not null default 'cod' check (payment_method in ('cod', 'bkash', 'nagad', 'bank', 'card')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid', 'partially_paid', 'refunded')),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),
  admin_note text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_status_idx on public.orders (status, created_at desc);
create index orders_created_idx on public.orders (created_at desc);
create index orders_user_idx on public.orders (user_id, created_at desc);
create index orders_customer_idx on public.orders (customer_id);
create index orders_phone_idx on public.orders (phone);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  variant_id uuid references public.product_variants (id) on delete set null,
  product_name text not null,
  product_slug text,
  variant_label text,
  sku text,
  image_url text,
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  quantity int not null check (quantity > 0),
  line_total numeric(12, 2) not null,
  created_at timestamptz not null default now()
);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_product_idx on public.order_items (product_id);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  customer_name text not null check (char_length(customer_name) between 1 and 80),
  rating int not null check (rating between 1 and 5),
  title text check (title is null or char_length(title) <= 120),
  body text not null check (char_length(body) between 10 and 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  is_verified_purchase boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, user_id)
);
create index reviews_product_status_idx on public.reviews (product_id, status, created_at desc);
create index reviews_status_idx on public.reviews (status, created_at desc);

create table public.wishlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);

alter table public.inventory
  add constraint inventory_order_fk foreign key (order_id) references public.orders (id) on delete set null;

create trigger customers_updated_at before update on public.customers for each row execute function public.set_updated_at();
create trigger coupons_updated_at before update on public.coupons for each row execute function public.set_updated_at();
create trigger orders_updated_at before update on public.orders for each row execute function public.set_updated_at();
create trigger reviews_updated_at before update on public.reviews for each row execute function public.set_updated_at();
