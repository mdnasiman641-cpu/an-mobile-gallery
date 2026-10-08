-- =====================================================================
-- Rebrand stored store data to "AN MOBILE GALLERY".
-- DATA ONLY: updates rows, does not change tables, policies or functions.
-- Only replaces values that still contain the old name, so anything you
-- already customised in Admin → Settings / SEO / Pages is left as it is.
-- Run once in Supabase → SQL Editor. Safe to run again.
-- =====================================================================
begin;

update public.site_settings
set store_name    = case when store_name = 'Afnan Mobile Gadgets' then 'AN MOBILE GALLERY' else store_name end,
    store_name_bn = case when store_name_bn is null or store_name_bn = 'আফনান মোবাইল গ্যাজেটস' then 'এএন মোবাইল গ্যালারি' else store_name_bn end
where id = 1;

update public.seo_settings
set site_title        = case when site_title = 'Afnan Mobile Gadgets' then 'AN MOBILE GALLERY' else site_title end,
    organization_name = case when organization_name is null or organization_name = 'Afnan Mobile Gadgets' then 'AN MOBILE GALLERY' else organization_name end
where id = 1;

update public.pages
set title            = replace(title, 'Afnan Mobile Gadgets', 'AN MOBILE GALLERY'),
    content          = replace(content, 'Afnan Mobile Gadgets', 'AN MOBILE GALLERY'),
    meta_title       = replace(meta_title, 'Afnan Mobile Gadgets', 'AN MOBILE GALLERY'),
    meta_description = replace(meta_description, 'Afnan Mobile Gadgets', 'AN MOBILE GALLERY')
where title like '%Afnan Mobile Gadgets%'
   or content like '%Afnan Mobile Gadgets%'
   or coalesce(meta_title, '') like '%Afnan Mobile Gadgets%'
   or coalesce(meta_description, '') like '%Afnan Mobile Gadgets%';

commit;

-- Check:
select store_name, store_name_bn from public.site_settings;
select site_title, organization_name from public.seo_settings;
select slug, title from public.pages order by slug;
