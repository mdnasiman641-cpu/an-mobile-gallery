# Analytics, ad tracking and cookie consent

Admin → **Settings → Analytics & tracking** (`/admin/settings/tracking`, admins only).

This page covers Google Tag Manager (web), Google Analytics 4, the Meta Pixel and Conversions API, and Google Ads conversions. It also covers cookie consent, server-side delivery and how to check each part.

**Current status:** the code is in place, but no account has been added yet. Until an admin adds an account, nothing loads on the shop and no cookie banner appears. Nothing has been checked against real Google or Meta accounts yet. That needs real IDs and a real test event (see [How to check](#6-how-to-check)).

---

## 1. One-time setup

### Run the database migration

Run `supabase/migrations/20261019000015_tracking.sql` once in the Supabase SQL editor.

- It only adds new tables and functions.
- No existing table, row or function is changed.

Until it has been run, the admin page says so and the shop works exactly as before.

### Environment variables

| Variable | Needed? | Secret? | Notes |
|---|---|---|---|
| *(none)* | — | — | On Cloudflare nothing new is needed. API tokens are encrypted with the existing key in the Worker's private R2 bucket, which is the same key store as the AI and Pathao keys. The tracking "server key" is also kept there and is created automatically. |
| `TRACKING_SERVER_KEY` | Local development only | **Yes** | At least 32 random characters. It is used only when the R2 binding isn't available (e.g. `next dev`). Put it in `.dev.vars` or your shell, **never** in `.env*`. `npm run cf:build` refuses to build if you do. |
| `AI_KEYS_ENCRYPTION_SECRET` | Local development only | **Yes** | This already exists for the AI keys. Locally it encrypts saved tokens. |

There is no new `NEXT_PUBLIC_` variable. Tokens and API secrets are entered in the admin page, sent only to this site's server, stored encrypted, and never sent back to a browser.

**Do not delete** these objects from the R2 bucket `an-mobile-gallery-cache`:

- `__app-secrets/ai-provider-keys/master-key.v1` holds the encryption key. If it is lost, every saved token must be entered again.
- `__app-secrets/tracking/server-key.v1` holds the server key. If it is lost, open the admin page once and a new one is registered.

---

## 2. Accounts you create (outside this website)

| Account | Where the value comes from | Secret? |
|---|---|---|
| **GTM web container ID** (`GTM-XXXXXXX`) | tagmanager.google.com → your container | No (it appears in page HTML) |
| **GA4 Measurement ID** (`G-XXXXXXXXXX`) | GA4 → Admin → Data streams → web stream | No |
| **GA4 Measurement Protocol API secret** | GA4 → Admin → Data streams → web stream → *Measurement Protocol API secrets* → Create | **Yes** |
| **Meta Pixel / Dataset ID** (digits) | Meta Events Manager → Data sources → your dataset | No |
| **Meta Conversions API access token** | Events Manager → dataset → Settings → *Conversions API* → Generate access token | **Yes** |
| **Meta Test Event Code** (e.g. `TEST12345`) | Events Manager → Test events → Conversions API | Not secret, but kept server-side |
| Meta Business ID / Ad account ID (optional) | Business settings / Ads Manager | No. Stored for reference only; nothing uses them |
| **Google Ads Conversion ID + label** (`AW-…/label`) (optional) | Google Ads → Goals → Conversions → your purchase conversion → Tag setup | No |
| GTM **server container** URL (optional) | Only if you deploy one yourself (separate hosting, may cost money) | No |

Not needed:

- Google Ads is **not** needed for GA4 or Meta.
- The Google Ads **API** (developer token, OAuth) is **not implemented**. It isn't needed to record conversions, and it needs Google's approval.

Each kind can have **several accounts**: add, edit, enable or disable, set default, verify, replace the secret, or remove. Without custom routing, an event goes only to the **default** account of each kind. A second Pixel or GA4 property therefore never doubles numbers by accident.

---

## 3. What runs where

### Browser (only with consent)

| Kind | Script | Owner of the browser events |
|---|---|---|
| GTM | `gtm.js?id=GTM-…` | One `dataLayer` message per event, in GA4 ecommerce format (`{event, event_id, ecommerce}`). Client-side page changes are pushed as `amg_page_view`. |
| GA4 | `gtag/js?id=G-…` | When the property is set to **direct (gtag)**: `gtag('event', …, {send_to})`. When it is set to **through GTM**, the site does *not* send GA4 directly; your GTM GA4 tags handle it. Use one or the other per property, never both. |
| Meta Pixel | `fbevents.js` | `fbq('trackSingle', pixelId, …, {eventID})`. Meta's own SPA page-view tracking is off; the site sends one PageView per page. |
| Google Ads | `gtag` | `conversion` on purchase only. With enhanced conversions it also sends `user_data` containing **SHA-256 hashes only**, made in the browser. |

Page views:

- **GA4** counts them itself. Keep *Enhanced measurement → Page changes based on browser history events* **on**.
- **Meta** and **GTM** get one message per new page. Opening the same page twice sends nothing.

### Server

This is the website's own Cloudflare Worker. It is **not** a GTM server container.

| Channel | What is sent | When |
|---|---|---|
| Meta Conversions API | Purchase. Optionally also add_to_cart, view_item, search and other browser events (Event routing). | Purchase: right after the order is created. Browser events: copied through `/api/events`. |
| GA4 Measurement Protocol | Refund for a cancelled or refunded order. Purchase **instead of the browser** only if routed that way. | Refund: when an admin cancels the order or marks it refunded. |

**GTM web vs GTM server vs Measurement Protocol:**

- **GTM web container:** a script in the visitor's browser. It decides which tags fire.
- **GTM server container:** your own server endpoint that GTM web tags send to. This site neither deploys nor uses one. The optional URL field only helps you keep it on record.
- **GA4 Measurement Protocol:** this site's server talks directly to GA4. It is used for refunds and optionally the purchase.
- **GA4 browser events:** gtag or GTM in the visitor's browser.

---

## 4. Events

| Internal (GA4 name) | Where | Meta |
|---|---|---|
| `view_item_list` | Listing / search / related grids | — (no standard event) |
| `select_item` | Click on a product card in a tracked list | — |
| `view_item` | Product page | ViewContent |
| `search` | Search results page | Search |
| `add_to_wishlist` | Heart button (new saves only; price not known there, so not sent) | AddToWishlist |
| `add_to_cart` | Add to cart / Buy now / + in cart | AddToCart |
| `remove_from_cart` | Remove / − in cart | — |
| `view_cart` | Cart page | — |
| `begin_checkout` | Checkout opened with items | InitiateCheckout |
| `add_shipping_info` | Delivery area chosen | — |
| `add_payment_info` | Order submitted with Cash on Delivery (before the result; **not** a purchase) | AddPaymentInfo |
| `purchase` | **Order successfully created** (server-confirmed) | Purchase |
| `refund` | Order cancelled or refunded (server, GA4 only) | — (Meta has no refund event) |
| `phone_click` / `whatsapp_click` | Any `tel:` / WhatsApp link (incl. EMI and exchange banners) | Contact |
| `add_to_compare` | Compare button | — |

Not tracked, because the feature doesn't exist (no fake buttons were added):

- lead or contact forms (`generate_lead`)
- an EMI inquiry form (EMI is a WhatsApp link, counted as `whatsapp_click`)
- store locator
- promotion impressions

**Item IDs:** the variant ID when a variant is chosen, otherwise the product ID, identical in every event. Prices are the real prices shown or charged. A price is never guessed: if it isn't known, it is left out.

> **For Meta / Google catalogue (dynamic) ads:** the Google Merchant feed uses the SKU as `id` when a product has one. Those products won't match catalogue items by ID until the feed and the events use the same ID. This was not changed, to avoid touching the feed.

---

## 5. Purchase definition and integrity

**Purchase = an order that `place_order()` created successfully.** This is a Cash on Delivery order accepted by the website, before the shop confirms it by phone.

- It is never sent on the button click. The browser sends it only after the server returns the created order.
- Order, total and items come from the **database** (`tracking_order_snapshot`), not from the browser.
- `transaction_id` = order number.
- `event_id` = `purchase.<order number>`. The browser Pixel and the server Conversions API use the same name and ID, so Meta keeps one.
- `tracking_conversions` has one row per order. A repeated request, double submit, refresh or retried response never queues a second purchase, and the database refuses it.
- The browser also remembers which order numbers it has sent, so a refresh or Back doesn't resend.
- Status changes (confirmed, shipped, delivered) are **not** new purchases.
- When an admin cancels an order or sets payment to *refunded*, one GA4 `refund` is sent for the full order value. It goes only to the GA4 properties that received the purchase, and only if the customer allowed analytics. It is sent at most once per order.
- Demo orders are never reported.
- Tracking can't make checkout fail. Every tracking step catches its own errors, and server delivery runs after the response (`after()` = Cloudflare `waitUntil`).

If you later prefer *confirmed* or *delivered* sales as the purchase, that is a business decision. It would need a server-only purchase at status change; it isn't implemented now (`purchase_trigger` allows only `order_placed`).

---

## 6. How to check

The admin page has a *How to verify* section with step-by-step instructions, a **Verify** button and an **I saw the events** button.

- **Meta:** **Verify** reads the dataset with the token. If a Test Event Code is saved, it sends one test PageView that appears only under *Test events*.
  - Status becomes **Connected** only if Meta accepted it.
  - Turn on **Test mode** to see real server purchases under Test events. **Turn it off for production.**
- **GA4:**
  - **Verify** checks the request format with Google's validation server. That check does **not** confirm the API secret.
  - It then sends one `tracking_test` event in debug mode. Check **Admin → DebugView**, then press **I saw the events**.
  - For browser events, use Realtime or DebugView. The property's Test mode adds `debug_mode`.
- **GTM:** Tag Manager → Preview → enter the shop URL, accept cookies, and look for the events.
- **Google Ads:** there is no test API. Check Conversions → Diagnostics after a test order; it can take hours.
- **Deduplication:** place a test order with Meta Test mode on. Test events should show **one** Purchase, marked deduplicated (browser + server).
- **Consent:** in a private window press *Reject optional*. There should be no requests to googletagmanager.com, google-analytics.com or facebook.net, no `_ga` or `_fbp` cookies, and no new server event.

A status of **Connected** is shown only after a real check. A saved ID or token alone shows *Configuration saved — verification pending*.

---

## 7. Consent

There is one first-party cookie, `amg_consent` (`v:<policy version>|a:0/1|m:0/1|t:<time>`, 6 months, SameSite=Lax). It counts as *necessary*, because it only remembers the choice.

- **Banner:** Accept all, Reject optional, Manage preferences. **Cookie settings** in the footer reopens it.
- **Categories:**
  - *Necessary*: cart, sign-in, the consent cookie.
  - *Analytics*: GA4 and GTM.
  - *Advertising*: Meta Pixel, Conversions API, Google Ads.
  - A separate "preferences" category isn't needed. The cart and compare list are in local storage and are necessary.
- **Browser:** a tag loads only when its category is allowed.
  - GTM loads with either category. Configure your GTM tags with built-in consent checks.
  - Google Consent Mode v2 is set before any Google tag (`analytics_storage`, `ad_storage`, `ad_user_data`, `ad_personalization`).
  - Withdrawing consent updates Consent Mode, revokes the Pixel, deletes `_ga*`, `_gid`, `_fbp`, `_fbc` and `_gcl_*`, and stops all further events.
- **Server:** the checkout action and `/api/events` read the **same cookie** from the request.
  - Without advertising consent there are no Conversions API events and no fbp/fbc/IP/user agent.
  - Without analytics consent there is no Measurement Protocol event and no GA client ID.
- **Admin settings:**
  - Banner on/off.
  - Each category offered or switched off. Switched off means never used.
  - Default before the choice: opt-in (default) or opt-out.
  - Policy version: changing it asks everyone again.
  - Opt-out or banner-off shows a warning. Whether a setting meets the law for your customers is your decision; Consent Mode alone does not make a site compliant.

### Privacy policy

The privacy policy page (`/pages/privacy-policy`) is content you manage in **Admin → Pages**, so it was not changed. If you use tracking, add a section that covers what you actually turn on. A starting point to adapt (not legal advice):

> **Cookies and measurement.** We use necessary cookies to run the shop (cart, sign-in, remembering your cookie choice). With your permission we use analytics cookies (Google Analytics / Google Tag Manager) to understand how the shop is used, and advertising cookies (Meta Pixel, Google Ads) to measure which ads lead to visits and orders. When you place an order and have allowed advertising cookies, our server also tells Meta about the purchase (order value, products, and — if enabled — a one-way hashed version of your email address and phone number). You can change your choice at any time with "Cookie settings" at the bottom of every page.

---

## 8. Server delivery, retries and data kept

- **Outbox** (`tracking_outbox`): one row per server event and account.
  - It is unique on `(event_id, account, channel)`.
  - It holds no name, address or raw phone number. Meta matching data (hashed email and phone, IP, user agent, fbp, fbc) stays in the row only until it is delivered, at most 7 days.
- **Delivery:** right after the response. The provider's answer is stored: Meta's `events_received` and `fbtrace_id`, or the error code and message with secrets redacted.
  - An event marked delivered is never sent again.
  - "Delivered" means Meta or GA4 **accepted** the request. It says nothing about ad attribution.
- **Retries:** for timeouts, network errors, HTTP 5xx and 429, and Meta's temporary or rate-limit codes. There are at most 5 attempts (back-off 1 min, 5 min, 25 min, 2 h) and nothing older than 7 days is sent.
  - Cloudflare Workers Free has no always-running job, and none was added. Due retries are sent along with the next order, when an admin opens the tracking page, or with **Send due events now**.
  - Failed events can be retried for 7 days (**Retry selected**).
- **Concurrency:** claiming uses `FOR UPDATE SKIP LOCKED` and a 2-minute lock, so two Workers never send the same row.
- **Browser-event copies** for Meta (`/api/events`) are sent once and directly, with no database row per event. That endpoint:
  - accepts only requests from the site's own pages;
  - accepts only allowed events (never purchase or refund);
  - needs advertising consent;
  - limits body size;
  - limits each visitor to 60 events per minute per Worker instance. This is best effort on Workers Free; add a Cloudflare WAF rate-limit rule if abuse appears.
- **Database security:**
  - Tracking tables are admin-only under RLS.
  - The storefront reads public IDs through `tracking_public_config()`.
  - Server functions require the server key (only its SHA-256 is in the database), so no service-role key is needed.
  - Every configuration change is written to `tracking_audit_log`, with field names only and never secret values.

### Cloudflare Free limits to keep in mind

- Each browser-event server copy is one Worker request. These are off by default, and only purchase is copied to Meta's server by default.
- A purchase adds about 2 small database calls to checkout, plus 1 to 2 outbound requests after the response.
- Third-party scripts load from Google and Meta, not from your Worker.

---

## 9. Troubleshooting

| Symptom | Check |
|---|---|
| No banner, no tags | Is an account added and enabled? Was migration 0015 run? After running it, save any tracking setting once so the shop's cached configuration refreshes. |
| Meta `INVALID_TOKEN (code 190)` | The token was revoked or copied wrongly. Edit → Replace, then Verify. |
| Meta `PERMISSION_DENIED` on Verify | The token can send but not read the dataset. Add a Test Event Code and Verify again (that test sends an event). |
| GA4 events missing | If the property is set to "through GTM", check that your GTM container has GA4 tags. If it is direct, check that analytics consent was given. Check Realtime / DebugView. |
| Purchase counted twice in GA4 | Make sure the property isn't *also* configured inside GTM while set to "direct (gtag)", and that the purchase isn't routed to the server while a GTM GA4 purchase tag also fires. |
| Server events "failed" | Server-side & delivery → error code and message. Fix it, then Retry selected. |
| "Server key not available" | On Cloudflare: check the R2 binding `NEXT_INC_CACHE_R2_BUCKET`. Locally: set `TRACKING_SERVER_KEY`. |
