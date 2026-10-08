-- =====================================================================
-- Remove all DEMO data before going live.
-- Keeps: brands, categories, pages, settings, admin users and any product,
-- banner, coupon or order you created yourself (is_demo = false).
-- Run in Supabase → SQL Editor.
-- =====================================================================
begin;

delete from public.orders    where is_demo;
delete from public.products  where is_demo;   -- cascades to variants, images, specs, features, inventory
delete from public.banners   where is_demo;
delete from public.coupons   where is_demo;
delete from public.customers where is_demo;

-- Redirects that pointed at deleted demo products
delete from public.slug_redirects r
where r.entity = 'product'
  and not exists (select 1 from public.products p where p.slug = r.new_slug);

commit;
