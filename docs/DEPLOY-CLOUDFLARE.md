# Deploying AN MOBILE GALLERY to Cloudflare Workers

Stack on Cloudflare: Next.js 16 → `@opennextjs/cloudflare` → one Worker.

| Piece | Cloudflare product | Free plan |
|---|---|---|
| Pages, Server Actions, route handlers | Worker `an-mobile-gallery` | 100,000 requests/day, **10 ms CPU per request** |
| Cached pages + `unstable_cache` data | R2 bucket `an-mobile-gallery-cache` | 10 GB, 1M writes / 10M reads per month |
| Time-based revalidation + on-demand revalidation | SQLite Durable Objects | 100,000 requests/day |
| `next/image` resizing | Images binding | 5,000 unique transformations/month |
| Static files (`/_next/static`, `/demo`) | Workers static assets | free, no Worker CPU |

Supabase stays exactly as it is (database, auth, storage).

---

## 0. One-time local preparation

Keep secrets out of `.env*` files: OpenNext copies everything in `.env`, `.env.local`, `.env.production` and `.env.production.local` into the Worker code. `npm run cf:build` refuses to build if the service-role key is in any of them.

| File | Contents | Used by |
|---|---|---|
| `.env.local` | `NEXT_PUBLIC_SITE_URL=http://localhost:3000`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `npm run dev` |
| `.env.production.local` | `NEXT_PUBLIC_SITE_URL=https://YOUR-DOMAIN` (overrides `.env.local` for builds) | `npm run build`, `npm run preview`, `npm run deploy` |
| `.dev.vars` | `SUPABASE_SERVICE_ROLE_KEY=…` | `npm run preview` only |

All three are git-ignored. Without the service-role key in `npm run dev`, only one thing changes: Admin → Staff users can't create brand-new accounts (it can still grant access to existing accounts).

---

## 1. Commands (run on your computer)

Windows: OpenNext's build is only partially supported on Windows. Use **WSL (Ubuntu)**, or use path B below (Cloudflare builds it on Linux for you).

```bash
npm install
npm run typecheck
npm run lint
npm run build            # plain Next.js build
npm run cf:check         # env/secret guard only
npm run preview          # OpenNext build + local Workers runtime at http://localhost:8787
node scripts/smoke-test.mjs http://localhost:8787 --site=https://YOUR-DOMAIN
```

`npm run preview` needs `.dev.vars` and your Supabase project. It does not deploy anything.

---

## 2. Cloudflare dashboard — one-time setup

1. **Domain:** Websites → Add a domain → follow the steps to move your domain's nameservers to Cloudflare. Wait until it shows *Active*.
2. **R2:** R2 Object Storage → activate R2 (Cloudflare may ask for a payment method even for the free allowance) → Create bucket → name **`an-mobile-gallery-cache`**, location Automatic.
3. **Images:** Images → enable Images / Transformations if the page offers it (needed for the `IMAGES` binding; the free plan includes 5,000 unique transformations per month).

## 3A. Deploy from your computer (Mac/Linux/WSL)

```bash
npx wrangler login
npx wrangler r2 bucket create an-mobile-gallery-cache   # skip if created in the dashboard
npm run deploy                                           # builds, uploads cache, deploys
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY        # paste the key when asked (optional)
```

## 3B. Deploy from GitHub (recommended on Windows)

1. Push the project to a **private** GitHub repository (`.gitignore` already excludes `.env*`, `.dev.vars`, `.open-next`, `.wrangler`).
2. Workers & Pages → Create → Import a repository → choose the repo.
3. Project name: **`an-mobile-gallery`** (must equal `name` in `wrangler.jsonc`).
4. Build settings:
   - Build command: `npm run cf:build`
   - Deploy command: `npx opennextjs-cloudflare deploy -- --keep-vars`
   - Non-production branch deploy command: `npx opennextjs-cloudflare upload -- --keep-vars`
5. Settings → Build → **Variables and secrets** (used during the build — `NEXT_PUBLIC_*` values are baked into the pages here):
   - `NEXT_PUBLIC_SITE_URL` = `https://YOUR-DOMAIN`
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://YOUR-REF.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon / publishable key
6. Save and deploy.

## 4. Worker settings (both paths)

Workers & Pages → `an-mobile-gallery` → **Settings → Variables and Secrets** (runtime):

| Name | Type | Value |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Text | `https://YOUR-DOMAIN` |
| `NEXT_PUBLIC_SUPABASE_URL` | Text | `https://YOUR-REF.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Text | anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | service_role key: needed for Admin → Staff users and the stock-system webhook import (no signed-in user there). Not needed for AI settings or AI generation from Admin |
| (AI provider keys) | — | **not configured in Cloudflare.** Entered in Admin → Settings → AI, encrypted with a key kept in the Worker's private R2 bucket (`__app-secrets/…`, created automatically; don't delete it) |
| `STOCK_WEBHOOK_SECRET` | **Secret** | 32+ random characters; signs stock-system webhooks (docs/STOCK-INTEGRATION.md) |
| `STOCK_EXPORT_URL` / `STOCK_EXPORT_TOKEN` | Text / **Secret** | optional, for "Sync stock now" |

The deploy commands use `--keep-vars`, so these are not wiped by later deploys. Do not set `NEXT_IMAGE_*` or `NEXT_OUTPUT` here.

**Settings → Domains & Routes → Add → Custom domain:** `YOUR-DOMAIN`, then again for `www.YOUR-DOMAIN`.
Then in the domain's dashboard: **Rules → Redirect Rules → "Redirect from WWW to root"** template. SSL/TLS → Edge Certificates → **Always Use HTTPS: On**.

Do **not** add a "Cache Everything" cache rule: the Worker already caches public pages in R2, and caching HTML at the CDN would also cache signed-in pages.

## 5. Supabase dashboard

**Database migrations (Homepage Management, AI, stock import):** SQL Editor → run
`supabase/migrations/20261009000010_homepage_ai_sync.sql`, then `20261009000011_ai_staff_access.sql`, then
`20261009000012_ai_product_completion.sql` (Complete with AI in the product form), then
`20261010000013_security_order_integrity.sql` (security and duplicate-order fixes; required by the current code for order pages,
adding staff and checkout), once each, in that order. Until then the homepage keeps its
built-in layout and the new admin pages show a "run the migration" notice; nothing else is affected.

**AI in the product form:** Admin → Products → New product. Enter the product name, selling price, RAM and ROM, then **Complete with AI**.
The product is saved as a hidden **Draft** first, AI fills the other fields for review (marked "AI"), and nothing is published until you
press **Save & publish** yourself. AI never receives or changes the price, discount, EMI, cost, stock, images or the RAM/ROM you typed.
Models are managed in Admin → Settings → AI (no Cloudflare settings). **Test connection** checks the key, the model and a real generation
request separately and shows the provider's own error.


Authentication → **URL Configuration**:
- Site URL: `https://YOUR-DOMAIN`
- Redirect URLs (add all):
  - `https://YOUR-DOMAIN/**`
  - `https://www.YOUR-DOMAIN/**`
  - `https://an-mobile-gallery.YOUR-SUBDOMAIN.workers.dev/**` (testing before the domain is live; remove later)
  - `http://localhost:3000/**` and `http://localhost:8787/**` (local testing)

Turn **Confirm email** back on for production (Authentication → Sign In / Providers → Email).

Optional brand data update (store name, SEO title, About page text): run `supabase/scripts/rebrand-an-mobile-gallery.sql` in the SQL Editor, or edit Admin → Settings and Admin → SEO.

## 6. After the first deploy

```bash
node scripts/smoke-test.mjs https://YOUR-DOMAIN --product=apple-iphone-15-pro-max \
  --image=https://YOUR-REF.supabase.co/storage/v1/object/public/media/<a-real-uploaded-image>.webp
```

Then by hand: admin login → upload a product image → save → the product page shows the new image and price at once (on-demand revalidation through the Durable Object tag cache).

## 6b. Keeping Worker CPU low on Workers Free (10 ms per request)

What uses the Worker on every request, and what to do about it:

| Request | Worker CPU | Notes |
|---|---|---|
| Cached public page (home, product, brand, category, info pages) | Low | Answered from the R2/regional cache before Next.js loads (`enableCacheInterception`). |
| Cache miss / refresh of a public page | **High** (full server render) | Happens after an admin change and on the time-based refresh. Product saves now refresh only the pages that list products, not the whole site; the homepage's time-based refresh is every 30 min. |
| Admin pages, account, checkout, filtered listings | **High** (always rendered per request) | Can't be cached (private or per-visitor). |
| `/_next/image` (optimised product photos) | Runs the Worker for **every image** | Every product photo on every page is a separate Worker request. |

**Taking images off the Worker (recommended on Free).** Two options, both set as **Build variables** (Settings → Build → Variables), then redeploy:

1. `NEXT_IMAGE_LOADER=cloudflare`: resizing by Cloudflare's edge (`/cdn-cgi/image/...`), which never runs the Worker. First enable it for the zone:
   Cloudflare dashboard → `anmobilegadgets.com` → **Images → Transformations → Enable for zone**, and allow your Supabase host
   (`<project-ref>.supabase.co`) as a source (or "any origin"). Same free allowance as now (5,000 unique transformations / month).
   Check one product photo loads before relying on it.
2. `NEXT_IMAGE_UNOPTIMIZED=true`: photos load straight from Supabase Storage (no Worker, no transformations). Uploads are already
   resized to 1600 px WebP (~150 KB), so pages download more image data than with resizing.

## 7. Known limits and what to do

| Symptom | Cause | Fix |
|---|---|---|
| **Error 1102 "Worker exceeded resource limits"** on admin, login, checkout, account or filtered pages | Either CPU (Free plan: 10 ms per request, including loading code in a fresh Worker instance; Paid: 30 s) or memory (128 MB per instance, both plans). Server-rendered admin pages can't be cached, so on Free they regularly need more than 10 ms, especially right after a deploy or idle time | **Confirm first:** Workers & Pages → `an-mobile-gallery` → **Metrics → Invocation statuses** (shows "Exceeded CPU Time Limits" vs "Exceeded Memory"), or **Observability → Events**, filter by outcome `exceededCpu` or `exceededMemory`, open one event and note its URL path, outcome, CPU time and wall time. If it is CPU on the Free plan: upgrade to **Workers Paid ($5/month)**; no code or config change needed. If it is memory: send those events for analysis |
| Build error mentioning Node.js middleware / `proxy` | `@opennextjs/cloudflare` older than 1.20.3 | `npm install @opennextjs/cloudflare@latest` |
| Product images fail with error 9422 | 5,000 free image transformations used this month | Set build variable `NEXT_IMAGE_UNOPTIMIZED=true` and redeploy (images are already compressed WebP) |
| Sign-up email link opens the wrong site | Supabase Site URL / Redirect URLs | Step 5 |
| Canonical URLs show the workers.dev or localhost address | `NEXT_PUBLIC_SITE_URL` wrong at build time | Fix the build variable and redeploy |
