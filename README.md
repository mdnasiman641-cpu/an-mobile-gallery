# AN MOBILE GALLERY

Mobile phone and gadgets store for Bangladesh with a full admin panel.
Next.js 16 (App Router, TypeScript, Tailwind CSS 4) + Supabase (Postgres, Auth, Storage).
English interface with Bangla touches, prices in Taka (৳) with lakh grouping (৳1,58,000).

---

## 1. Quick start (local)

Requirements: Node.js 20.9+ and a free Supabase project.

```bash
npm install
cp .env.example .env.local      # fill in the Supabase values (step 2)
npm run dev                     # http://localhost:3000
npm run build                   # production build check
```

## 2. Supabase setup (once)

1. Create a project at supabase.com. Copy **Project URL** and **anon key** (Settings → API) into `.env.local`.
2. Create the database. Either:
   - **CLI:** `npx supabase link --project-ref <ref>` then `npx supabase db push` and run `supabase/seed.sql`, or
   - **Dashboard:** open SQL Editor and run every file in `supabase/migrations/` **in filename order**, then `supabase/seed.sql`.
3. **Auth → URL configuration:** set Site URL to your domain and add `http://localhost:3000/**` and `https://your-domain.com/**` to redirect URLs.
4. **Create the first admin.** Register an account on the site (`/register`) or in Auth → Users, then run in SQL Editor:
   ```sql
   insert into public.admin_users (user_id, role)
   select id, 'super_admin' from auth.users where email = 'you@example.com';
   ```
   Sign in at `/admin/login`. Further staff can be added from **Admin → Staff users**.
5. Optional: put `SUPABASE_SERVICE_ROLE_KEY` in the **server** environment so Admin → Staff users can create accounts directly. It is never sent to the browser.

### Demo data
`seed.sql` adds starter brands and categories (kept) and 14 **demo** products, 3 demo banners and a demo coupon `WELCOME500` (all `is_demo = true`, shown with a "Demo" badge in the admin). Demo products are `noindex`, left out of the sitemap and the Merchant feed, so they can't reach Google even if you deploy before cleaning up. Before going live run `supabase/scripts/delete-demo-data.sql`. No reviews or orders are seeded.

## 3. Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | all | Your domain, e.g. `https://afnanmobile.com`. Used for canonical URLs, sitemap, Open Graph, JSON-LD. |
| `NEXT_PUBLIC_SUPABASE_URL` | all | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | all | Public anon key (safe; RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Optional. Only for creating staff accounts. Never prefix with `NEXT_PUBLIC_`. On Cloudflare: a Worker **secret**, and `.dev.vars` for `npm run preview` — never in `.env*` files. |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | all | Optional; can be set in Admin → SEO instead |
| `NEXT_IMAGE_UNOPTIMIZED` | build | `true` serves uploaded WebP images as-is (no image-optimisation cost) |
| `NEXT_IMAGE_LOADER` | build | `cloudflare` resizes images with Cloudflare Image Transformations |
| `NEXT_OUTPUT` | build | `standalone` for Docker/VPS hosting |

## 4. Deploy

### Vercel
1. Push the project to GitHub and import it in Vercel (framework: Next.js, no extra settings).
2. Add the environment variables above (Production + Preview).
3. Deploy. Then set `NEXT_PUBLIC_SITE_URL` to the final domain and redeploy once.
4. Free-tier tip: if you approach the image optimisation limit, set `NEXT_IMAGE_UNOPTIMIZED=true` — uploads are already compressed WebP.

### Cloudflare Workers (primary target) — see `docs/DEPLOY-CLOUDFLARE.md`
Runs on Cloudflare Workers through the OpenNext adapter (`@opennextjs/cloudflare`). Config lives in `wrangler.jsonc` and `open-next.config.ts`. Cached pages are stored in R2; revalidation uses SQLite Durable Objects; `next/image` uses the Cloudflare Images binding.
`npm run preview` runs the production build locally in the Workers runtime; `npm run deploy` builds and deploys. Both run `scripts/check-env.mjs`, which stops the build if the service-role key is in any `.env*` file (OpenNext copies `.env*` values into the Worker) and scans the output for leaked keys.

### Any Node host (VPS, Docker, Render, Railway)
`NEXT_OUTPUT=standalone npm run build`, then run `node .next/standalone/server.js` (copy `.next/static` and `public` next to it).

### Behind Cloudflare CDN (any host)
- SSL mode **Full (strict)**, "Always use HTTPS" on, redirect `www` ↔ apex with one rule.
- Cache rule: **bypass** cache for `/admin*`, `/account*`, `/checkout*`, `/cart*`, `/api/*`, `/login`, `/register`. Everything else may follow origin cache headers.
- Canonical/sitemap/JSON-LD URLs come from `NEXT_PUBLIC_SITE_URL`, never from the request host, so proxies cannot produce wrong canonicals.
- Do not enable Rocket Loader or HTML minification (they can break hydration).

## 5. Google
- **Search Console:** paste the HTML-tag verification code in Admin → SEO, then submit `https://your-domain/sitemap.xml`.
- **Merchant Center:** add `https://your-domain/feeds/google-merchant.xml` as a scheduled feed. Fill in barcode (GTIN) or MPN on products for best results. Demo products are excluded from the feed.

## 6. How it stays fast and cheap

- **Static catalog pages (ISR):** home (10 min), product pages and the plain `/products`, `/offers`, `/brands/<slug>`, `/categories/<slug>` pages (1 h) are cached HTML read through a cookie-less Supabase client. Admin saves and orders purge the affected pages and data immediately. If Supabase is briefly down, the last good page keeps being served.
- **Filtered listings:** the same URLs with `?page=`, `?sort=`, `?ram=`… are routed by `next.config.ts` rewrites to `app/(store)/browse/...`, rendered per request with query results cached per filter combination. Unknown parameters such as `utm_source` still get the cached page.
- **Always fresh:** search results and checkout (prices, stock, coupons) read the database directly. Checkout re-prices the browser cart when it opens, and `place_order()` re-checks everything in one transaction. Settings and menus are cached for a day and refreshed on save.
- **One query per listing:** `search_products()` returns product, brand and primary image together (no N+1). Full-text + trigram indexes; GIN indexes on RAM/storage filters.
- **Browser-side work:** cart and compare live in `localStorage`; images are resized to ≤1600 px WebP before upload, stored with unique names and a 1-year cache header.
- **No Realtime, no Edge Functions, no polling.** Autocomplete is debounced, memoised and CDN-cacheable. Product views are counted once per browser session.
- Upgrading Supabase or hosting needs no code change.

## 7. Security model
- Row Level Security on every table. Public can read only active catalog data, approved reviews and published content.
- Roles: `super_admin` (everything + staff), `admin` (everything but staff), `editor` (catalog & content). Checked in the admin layout, in every server action, and again in Postgres.
- Orders are created only by `place_order()`: it re-prices every item from the database, locks rows, checks stock, applies coupons and delivery charges in one transaction. Browser prices are ignored.
- Purchase cost lives in `product_costs` (admin-only), not in the public `products` table.
- Storage: one public `media` bucket; images are served by public URL, but only staff can list, upload or delete files. SVG uploads are blocked.

## 8. Project structure
```
app/(store)/        public website (home, products, search, cart, checkout, account…)
app/(store)/browse/ per-request versions of filtered listings (internal rewrite target)
app/admin/          admin panel (login + protected (panel) group)
app/api/            search suggestions
app/feeds/          Google Merchant feed
app/sitemap.ts      dynamic sitemap      app/robots.ts   robots.txt
components/         ui/, store/, admin/, auth/, seo/
lib/                supabase clients, auth guards, SEO + JSON-LD builders, validation, cache
services/           data access (catalog, settings, listing, admin)
supabase/           migrations (schema, triggers, RPC, RLS, storage), seed.sql, scripts/
deploy/cloudflare/  OpenNext + wrangler templates
```

## 9. Database tables
`users`, `admin_users`, `brands`, `categories`, `products`, `product_costs`, `product_variants`, `product_images`, `product_specifications`, `product_features`, `inventory` (stock history), `slug_redirects`, `customers`, `orders`, `order_items`, `reviews`, `coupons`, `wishlists`, `banners`, `pages`, `site_settings`, `seo_settings`.

Key functions: `search_products`, `get_filter_options`, `place_order`, `validate_coupon`, `get_order_confirmation`, `record_product_view`, `admin_update_order` (restocks on cancel), `admin_adjust_stock`, `duplicate_product`, `dashboard_stats`.
