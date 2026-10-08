-- =====================================================================
-- 0004 · Banners, pages, site settings, SEO settings
-- =====================================================================

create table public.banners (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  subtitle text,
  image_url text not null,
  mobile_image_url text,
  button_text text,
  button_url text,
  placement text not null default 'hero' check (placement in ('hero', 'promo')),
  is_active boolean not null default true,
  sort_order int not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index banners_active_idx on public.banners (placement, is_active, sort_order);

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title text not null,
  content text not null default '',
  meta_title text,
  meta_description text,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Single-row settings tables (id is always 1).
create table public.site_settings (
  id smallint primary key default 1 check (id = 1),
  store_name text not null default 'Afnan Mobile Gadgets',
  store_name_bn text default 'আফনান মোবাইল গ্যাজেটস',
  tagline text default 'Original phones, honest prices',
  tagline_bn text default 'আসল ফোন, সঠিক দাম',
  logo_url text,
  phone text,
  whatsapp text,
  email text,
  address text,
  address_bn text,
  map_url text,
  facebook_url text,
  instagram_url text,
  youtube_url text,
  tiktok_url text,
  opening_hours text default 'Sat–Thu, 10:00 AM – 9:00 PM',
  delivery_charge_inside_dhaka numeric(12, 2) not null default 60,
  delivery_charge_outside_dhaka numeric(12, 2) not null default 120,
  free_delivery_threshold numeric(12, 2) not null default 0,
  currency text not null default 'BDT',
  currency_symbol text not null default '৳',
  return_days int not null default 7 check (return_days >= 0),
  return_policy text,
  shipping_note text,
  updated_at timestamptz not null default now()
);

create table public.seo_settings (
  id smallint primary key default 1 check (id = 1),
  site_title text not null default 'Afnan Mobile Gadgets',
  site_description text not null default 'Buy original smartphones, used phones and gadgets in Bangladesh at the best price. Official and unofficial phones, fast delivery and warranty support.',
  default_keywords text default 'mobile phone price in Bangladesh, smartphone shop BD, used phone, iPhone price BD, Samsung price BD',
  default_og_image text,
  google_site_verification text,
  facebook_domain_verification text,
  twitter_handle text,
  organization_name text default 'Afnan Mobile Gadgets',
  organization_legal_name text,
  organization_logo text,
  organization_founding_year int,
  updated_at timestamptz not null default now()
);

insert into public.site_settings (id) values (1) on conflict do nothing;
insert into public.seo_settings (id) values (1) on conflict do nothing;

create trigger banners_updated_at before update on public.banners for each row execute function public.set_updated_at();
create trigger pages_updated_at before update on public.pages for each row execute function public.set_updated_at();
create trigger site_settings_updated_at before update on public.site_settings for each row execute function public.set_updated_at();
create trigger seo_settings_updated_at before update on public.seo_settings for each row execute function public.set_updated_at();
