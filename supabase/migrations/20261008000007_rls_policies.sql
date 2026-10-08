-- =====================================================================
-- 0007 · Row Level Security
-- Public (anon) can only read what a shopper should see. Staff writes are
-- authorised by public.is_staff() / is_admin() / is_super_admin().
-- =====================================================================

alter table public.users enable row level security;
alter table public.admin_users enable row level security;
alter table public.brands enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_costs enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_images enable row level security;
alter table public.product_specifications enable row level security;
alter table public.product_features enable row level security;
alter table public.inventory enable row level security;
alter table public.slug_redirects enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.reviews enable row level security;
alter table public.coupons enable row level security;
alter table public.wishlists enable row level security;
alter table public.banners enable row level security;
alter table public.pages enable row level security;
alter table public.site_settings enable row level security;
alter table public.seo_settings enable row level security;

-- ---- users -----------------------------------------------------------
create policy "users: read own" on public.users for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy "users: update own" on public.users for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---- admin_users -----------------------------------------------------
create policy "admin_users: staff read" on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "admin_users: super admin insert" on public.admin_users for insert to authenticated
  with check ((select public.is_super_admin()));
create policy "admin_users: super admin update" on public.admin_users for update to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
create policy "admin_users: super admin delete" on public.admin_users for delete to authenticated
  using ((select public.is_super_admin()) and user_id <> (select auth.uid()));

-- ---- catalog: public read, staff write -------------------------------
create policy "brands: public read" on public.brands for select to anon, authenticated
  using (is_active or (select public.is_staff()));
create policy "brands: staff write" on public.brands for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy "categories: public read" on public.categories for select to anon, authenticated
  using (is_active or (select public.is_staff()));
create policy "categories: staff write" on public.categories for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy "products: public read" on public.products for select to anon, authenticated
  using (status in ('active', 'out_of_stock') or (select public.is_staff()));
create policy "products: staff write" on public.products for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy "product_costs: admin only" on public.product_costs for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "variants: public read" on public.product_variants for select to anon, authenticated
  using (
    (status = 'active' and exists (
      select 1 from public.products p where p.id = product_id and p.status in ('active', 'out_of_stock')))
    or (select public.is_staff())
  );
create policy "variants: staff write" on public.product_variants for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy "images: public read" on public.product_images for select to anon, authenticated
  using (
    exists (select 1 from public.products p where p.id = product_id and p.status in ('active', 'out_of_stock'))
    or (select public.is_staff())
  );
create policy "images: staff write" on public.product_images for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy "specs: public read" on public.product_specifications for select to anon, authenticated
  using (
    exists (select 1 from public.products p where p.id = product_id and p.status in ('active', 'out_of_stock'))
    or (select public.is_staff())
  );
create policy "specs: staff write" on public.product_specifications for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy "features: public read" on public.product_features for select to anon, authenticated
  using (
    exists (select 1 from public.products p where p.id = product_id and p.status in ('active', 'out_of_stock'))
    or (select public.is_staff())
  );
create policy "features: staff write" on public.product_features for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy "inventory: staff read" on public.inventory for select to authenticated
  using ((select public.is_staff()));
create policy "inventory: staff insert" on public.inventory for insert to authenticated
  with check ((select public.is_staff()));

create policy "slug_redirects: public read" on public.slug_redirects for select to anon, authenticated
  using (true);
create policy "slug_redirects: staff write" on public.slug_redirects for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- ---- customers & orders ---------------------------------------------
create policy "customers: read own" on public.customers for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "customers: update own" on public.customers for update to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "customers: admin insert" on public.customers for insert to authenticated
  with check ((select public.is_admin()));
create policy "customers: admin delete" on public.customers for delete to authenticated
  using ((select public.is_admin()));

-- Orders are created only through place_order(); customers can read their own.
create policy "orders: read own" on public.orders for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "orders: admin update" on public.orders for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "orders: admin delete" on public.orders for delete to authenticated
  using ((select public.is_admin()));

create policy "order_items: read own" on public.order_items for select to authenticated
  using (
    exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid()))
    or (select public.is_admin())
  );

-- ---- reviews ---------------------------------------------------------
create policy "reviews: public read approved" on public.reviews for select to anon, authenticated
  using (status = 'approved' or user_id = (select auth.uid()) or (select public.is_staff()));
create policy "reviews: customers submit" on public.reviews for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending');
create policy "reviews: staff moderate" on public.reviews for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy "reviews: delete own or staff" on public.reviews for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff()));

-- ---- coupons (admin only; shoppers validate via validate_coupon) ------
create policy "coupons: admin all" on public.coupons for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---- wishlists -------------------------------------------------------
create policy "wishlists: own" on public.wishlists for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---- content ---------------------------------------------------------
create policy "banners: public read active" on public.banners for select to anon, authenticated
  using (
    (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()))
    or (select public.is_staff())
  );
create policy "banners: staff write" on public.banners for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy "pages: public read published" on public.pages for select to anon, authenticated
  using (is_published or (select public.is_staff()));
create policy "pages: staff write" on public.pages for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy "site_settings: public read" on public.site_settings for select to anon, authenticated
  using (true);
create policy "site_settings: admin update" on public.site_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "seo_settings: public read" on public.seo_settings for select to anon, authenticated
  using (true);
create policy "seo_settings: admin update" on public.seo_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
