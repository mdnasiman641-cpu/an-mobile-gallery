# SEO and Google Search Console — owner steps

The site already outputs: a title, description and canonical URL on every public page; Open Graph / Twitter data
(with the store name); `robots.txt`; `sitemap.xml` (only indexable pages); Organization, WebSite, BreadcrumbList and
Product (price, availability, condition, brand, ratings only from approved reviews) structured data; noindex on cart,
checkout, account, login, search, compare and filtered listings; a Google Merchant feed at `/feeds/google-merchant.xml`.

Google decides what is indexed and how it ranks. Nothing below guarantees a ranking.

## 1. Use the official name everywhere (Admin, 2 minutes)

The live site currently shows the name stored in the database settings. To show **AN MOBILE GALLERY**:

- Admin → Settings → **Store name**: `AN MOBILE GALLERY`
- Admin → SEO → **Site title**: `AN MOBILE GALLERY | New & Used Mobile Phones in Bangladesh`
- Admin → SEO → **Site description** (example, edit to match what you really sell):
  `Buy new and used mobile phones in Bangladesh: iPhone, Samsung, Xiaomi and more. Cash on delivery, checked used phones, exchange and installment at our Kapasia, Gazipur shop.`
- Admin → SEO → **Organisation name**: `AN MOBILE GALLERY`; add the **Organisation logo** and a **Default share image (Open Graph)**.

Alternatively run `supabase/scripts/rebrand-an-mobile-gallery.sql` in the Supabase SQL Editor (review it first).
Saving settings refreshes every page automatically.

## 2. Verify the site in Search Console

1. Open https://search.google.com/search-console → **Add property**.
2. Recommended: **Domain** property `anmobilegadgets.com`, verified with a DNS TXT record:
   Cloudflare dashboard → `anmobilegadgets.com` → DNS → Add record → Type `TXT`, Name `@`, Content = the value Google shows.
3. Or a **URL-prefix** property `https://anmobilegadgets.com/` with the HTML tag method: paste only the `content` value
   into Admin → SEO → **Google Search Console verification**, save, then click Verify.

## 3. Submit the sitemap

Search Console → Sitemaps → enter `sitemap.xml` → Submit. It lists the home page, listing pages, every active
brand and category, every published product (not demo products) and published content pages.

## 4. Inspect and request indexing

- URL Inspection → `https://anmobilegadgets.com/` → **Test live URL** → if "URL is available to Google", **Request indexing**.
- Repeat for your most important product pages (one request per URL; Google limits how many per day).
- Use "View tested page → More info" to check the Product structured data was detected.

## 5. Monitor

- **Pages** (indexing): look at "Why pages aren't indexed". Pages marked *Excluded by 'noindex' tag* for cart,
  checkout, account, search and filtered listings are expected.
- **Enhancements → Product snippets / Merchant listings**: fix any errors reported.
- **Security & Manual actions**: should both say "No issues detected".
- Re-check after big catalogue changes; the sitemap updates itself (about hourly, or right after you save products).

## 6. Google Merchant Center (optional)

Merchant Center → Products → Feeds → add a scheduled fetch of `https://anmobilegadgets.com/feeds/google-merchant.xml`.
It contains only real product data (price, availability, condition, brand, images). Products with neither a barcode nor an MPN
are sent with `identifier_exists = no`.
