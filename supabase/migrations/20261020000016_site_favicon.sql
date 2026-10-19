-- =====================================================================
-- 0016 · Site favicon managed in Admin → Settings → Branding & Favicon
--
-- One new column. The icon images themselves live in the existing public
-- "media" bucket under site/favicon/<favicon_id>/ (square PNGs checked by
-- the server before upload); only the id of the active set is stored here.
-- NULL = use the built-in brand icon. Existing rows and policies unchanged
-- (site_settings is publicly readable and admin-updatable already).
-- =====================================================================

alter table public.site_settings add column if not exists favicon_id uuid;

comment on column public.site_settings.favicon_id is
  'Active uploaded favicon set: media/site/favicon/<id>/*.png. NULL = built-in icon.';
