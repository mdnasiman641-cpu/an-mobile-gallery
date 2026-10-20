-- 0020 · Header & Navigation menu (Admin → Settings → Header & Navigation).
--
-- Stored with the other header settings (public.storefront_header, from
-- migration 0018), in one extra column:
--   nav jsonb   null = the built-in menu (unchanged website)
--               { "items": [...], "style": {...} } = the admin's menu
-- The app validates every item (lib/navigation.ts): two levels only (no
-- circular menus), safe links, existing categories, limits. Same rules as the
-- rest of the row: anyone can read it, only admins can change it.
--
-- Requires migration 0018. Safe to run more than once.

begin;

alter table public.storefront_header add column if not exists nav jsonb
  check (nav is null or (jsonb_typeof(nav) = 'object' and jsonb_typeof(nav -> 'items') = 'array' and jsonb_array_length(nav -> 'items') <= 80));

comment on column public.storefront_header.nav is
  'Main menu (Admin → Settings → Header & Navigation). null = built-in menu. Max 80 items, two levels.';

grant update (nav) on table public.storefront_header to authenticated;

commit;
