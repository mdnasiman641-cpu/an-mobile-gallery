-- =====================================================================
-- 0008 · Storage: one public "media" bucket
--   products/<product-id>/<file>.webp
--   brands/<file>   banners/<file>   site/<file>   categories/<file>
-- Anyone can view; only staff can upload, replace or delete.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "media: public read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'media');

create policy "media: staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (select public.is_staff()));

create policy "media: staff update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (select public.is_staff()))
  with check (bucket_id = 'media' and (select public.is_staff()));

create policy "media: staff delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (select public.is_staff()));

-- ---------------------------------------------------------------------
-- Starter content pages (real store content; edit from Admin → Pages)
-- ---------------------------------------------------------------------
insert into public.pages (slug, title, content, meta_description) values
(
  'about',
  'About Afnan Mobile Gadgets',
  E'Afnan Mobile Gadgets sells original smartphones, quality used phones and everyday gadgets across Bangladesh.\n\n## What we stand for\n\n- Every phone is checked before it leaves the shop\n- Clear prices in Taka, with no hidden charges\n- Warranty details written on every product page\n- Help on WhatsApp before and after you buy\n\n## Visit or order online\n\nOrder online with Cash on Delivery, or visit the shop to see the phone in your hand before you buy.',
  'Learn about Afnan Mobile Gadgets — original smartphones, checked used phones and gadgets in Bangladesh with clear prices and warranty support.'
),
(
  'warranty-and-returns',
  'Warranty & Returns',
  E'## Warranty\n\nWarranty terms depend on the product and are shown on each product page.\n\n## Returns\n\nIf a product has a manufacturing fault, contact us within the return period shown at checkout with your order number.',
  'Warranty and return policy of Afnan Mobile Gadgets.'
),
(
  'privacy-policy',
  'Privacy Policy',
  E'We collect only the information needed to deliver your order: your name, phone number, address and optional email.\n\nWe never sell your information. We use your phone number to confirm orders and arrange delivery.',
  'How Afnan Mobile Gadgets handles your personal information.'
)
on conflict (slug) do nothing;
