-- =====================================================================
-- Brand name "AN MOBILE GADGETS" + proposed homepage title / description.
-- DATA ONLY (no tables, policies or functions change). Optional: you can
-- make the same edits in Admin → Settings and Admin → SEO instead.
-- Only values that still hold an earlier form of the name (or the old
-- generic homepage text) are replaced; anything else you wrote is kept.
-- Run in Supabase → SQL Editor. Safe to run again.
-- =====================================================================
begin;

update public.site_settings
set store_name = 'AN MOBILE GADGETS'
where id = 1
  and lower(store_name) in ('an mobile gadgets', 'an mobile gallery', 'afnan mobile gadgets');

update public.seo_settings
set organization_name = case
      when organization_name is null or lower(organization_name) in ('an mobile gadgets', 'an mobile gallery', 'afnan mobile gadgets') then 'AN MOBILE GADGETS'
      else organization_name end,
    organization_legal_name = case
      when lower(coalesce(organization_legal_name, '')) in ('an mobile gadgets', 'an mobile gallery') then 'AN MOBILE GADGETS'
      else organization_legal_name end,
    site_title = case
      when lower(site_title) in ('an mobile gadgets', 'an mobile gallery', 'afnan mobile gadgets') then 'AN MOBILE GADGETS | New & Used Mobile Phones in Bangladesh'
      else site_title end,
    site_description = case
      when site_description like 'Buy original smartphones, used phones and gadgets in Bangladesh at the best price.%'
        then 'Shop new and used iPhones, Samsung and Android smartphones at AN MOBILE GADGETS. Explore mobile phone prices, browse available products, and contact our shop in Bangladesh.'
      else site_description end
where id = 1;

commit;

-- Check:
select store_name from public.site_settings;
select site_title, site_description, organization_name, organization_legal_name from public.seo_settings;
